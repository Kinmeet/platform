import { defineEventHandler } from 'h3'
import type { StoredForm } from '../utils/db/forms'
import { formSubmissionExists, insertFormSubmission } from '../utils/db/forms'
import { useDb } from '../utils/db/env'
import { handleFormSubmission } from '../utils/forms/handler'
import { openForm } from '../utils/forms/stored'

/**
 * Say hello (docs/api/forms.md, section 1), on the stored form `hello`
 * (ADR-0010). No receipt email in Sprint 1. Messages from children are
 * stored like any other and age is never asked (Head of Delivery,
 * 25 October; an open area 5 question).
 */
export default defineEventHandler((event) => {
  let form: StoredForm | undefined
  return handleFormSubmission(event, {
    form: 'hello',
    load: async (event) => {
      const loaded = await openForm(useDb(event), 'hello')
      form = loaded.form
      return loaded.runtime
    },
    receipt: 'not_requested',
    exists: (event, submissionId) => formSubmissionExists(useDb(event), submissionId),
    store: (event, submission) =>
      insertFormSubmission(useDb(event), form!, submission, { roundClosesAt: 0 }),
  })
})
