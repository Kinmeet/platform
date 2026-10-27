import { defineEventHandler } from 'h3'
import { HELLO_BODY_CAP, helloSchema } from '../../shared/forms/hello'
import { useDb } from '../utils/db/env'
import { helloMessageExists, insertHelloMessage } from '../utils/db/hello-messages'
import { handleFormSubmission } from '../utils/forms/handler'

/**
 * Say hello (docs/api/forms.md, section 1). No receipt email in Sprint 1.
 * Messages from children are stored like any other and age is never asked
 * (Head of Delivery, 25 October; an open area 5 question).
 */
export default defineEventHandler((event) =>
  handleFormSubmission(event, {
    form: 'hello',
    schema: helloSchema,
    bodyCap: HELLO_BODY_CAP,
    receipt: 'not_requested',
    exists: (event, submissionId) => helloMessageExists(useDb(event), submissionId),
    store: (event, submission) => insertHelloMessage(useDb(event), submission),
  }),
)
