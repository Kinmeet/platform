import { z } from 'zod'
import {
  EMAIL_MAX,
  SUBMISSION_ID_LENGTH,
  TURNSTILE_TOKEN_MAX,
  bodyCapBytes,
  callName,
  email,
  submissionId,
  text,
  turnstileToken,
} from './fields'

const MESSAGE_MAX = 2000
const CALL_NAME_MAX = 60

/** Say hello: `POST /api/hello` (docs/api/forms.md, section 1). */
export const helloSchema = z.strictObject({
  submissionId,
  callName,
  email,
  message: text(MESSAGE_MAX),
  turnstileToken,
})

export type HelloSubmission = z.infer<typeof helloSchema>

/** The largest body a valid say hello request can have. */
export const HELLO_BODY_CAP = bodyCapBytes([
  SUBMISSION_ID_LENGTH,
  CALL_NAME_MAX,
  EMAIL_MAX,
  MESSAGE_MAX,
  TURNSTILE_TOKEN_MAX,
])
