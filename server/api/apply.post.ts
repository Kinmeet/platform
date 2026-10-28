import { defineEventHandler } from 'h3'
import type { StoredForm } from '../utils/db/forms'
import { formSubmissionExists, insertFormSubmission } from '../utils/db/forms'
import { useDb } from '../utils/db/env'
import { queueEmail } from '../utils/email'
import { handleFormSubmission } from '../utils/forms/handler'
import { applicationForms } from '../utils/forms/stored'

/**
 * When the founding round closes, as Unix-epoch seconds in the
 * `APPLY_ROUND_CLOSES_AT` var. Until a date is set, the backstop deletion date
 * is 6 months after receipt (the shorter of the two choices).
 */
export function roundClosesAt(env: { APPLY_ROUND_CLOSES_AT?: string } | undefined): number {
  const value = Number(env?.APPLY_ROUND_CLOSES_AT ?? '')
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
 * Apply for a role (docs/api/forms.md, section 2), on the stored application
 * forms (ADR-0010): the `role` is a form's slug. The receipt email is queued
 * only after the row is first stored, and a failed receipt never fails the
 * application. A repeat answers `not_requested`, so it never claims an email
 * that may not have been sent.
 */
export default defineEventHandler((event) => {
  let forms: StoredForm[] = []
  return handleFormSubmission(event, {
    form: 'apply',
    load: async (event) => {
      const loaded = await applicationForms(useDb(event))
      forms = loaded.forms
      return loaded.runtime
    },
    receipt: 'not_requested',
    exists: (event, submissionId) => formSubmissionExists(useDb(event), submissionId),
    store: (event, submission) => {
      // The schema only accepts the role of an open form.
      const form = forms.find((candidate) => candidate.slug === submission.role)
      if (!form) throw new Error('form_not_open')
      return insertFormSubmission(useDb(event), form, submission, {
        roundClosesAt: roundClosesAt(
          (event.context as { cloudflare?: { env?: { APPLY_ROUND_CLOSES_AT?: string } } })
            .cloudflare?.env,
        ),
      })
    },
    afterStore: async (event, submission) => {
      const form = forms.find((candidate) => candidate.slug === submission.role)
      if (form?.current?.definition.receipt !== 'application_receipt') return 'not_requested'
      return queueEmail(event, {
        to: submission.email,
        template: 'application_receipt',
        locale: 'en-GB',
      })
    },
  })
})
