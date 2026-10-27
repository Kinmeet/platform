import { defineEventHandler } from 'h3'
import { APPLY_BODY_CAP, applySchema } from '../../shared/forms/apply'
import { applicationExists, insertApplication } from '../utils/db/applications'
import { useDb } from '../utils/db/env'
import { queueEmail } from '../utils/email'
import { handleFormSubmission } from '../utils/forms/handler'

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
 * Apply for a role (docs/api/forms.md, section 2). The receipt email is
 * queued only after the row is first stored, and a failed receipt never
 * fails the application. A repeat answers `not_requested`, so it never
 * claims an email that may not have been sent.
 */
export default defineEventHandler((event) =>
  handleFormSubmission(event, {
    form: 'apply',
    schema: applySchema,
    bodyCap: APPLY_BODY_CAP,
    receipt: 'not_requested',
    exists: (event, submissionId) => applicationExists(useDb(event), submissionId),
    store: (event, submission) =>
      insertApplication(useDb(event), submission, {
        roundClosesAt: roundClosesAt(
          (event.context as { cloudflare?: { env?: { APPLY_ROUND_CLOSES_AT?: string } } })
            .cloudflare?.env,
        ),
      }),
    afterStore: (event, submission) =>
      queueEmail(event, { to: submission.email, template: 'application_receipt', locale: 'en-GB' }),
  }),
)
