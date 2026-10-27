import { z } from 'zod'
import {
  CALL_NAME_MAX,
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

/** Most code points a say hello message may have. */
export const HELLO_MESSAGE_MAX = 2000

/** Say hello: `POST /api/hello` (docs/api/forms.md, section 1). */
export const helloSchema = z.strictObject({
  submissionId,
  callName,
  email,
  message: text(HELLO_MESSAGE_MAX),
  turnstileToken,
})

export type HelloSubmission = z.infer<typeof helloSchema>

/** The largest body a valid say hello request can have. */
export const HELLO_BODY_CAP = bodyCapBytes([
  SUBMISSION_ID_LENGTH,
  CALL_NAME_MAX,
  EMAIL_MAX,
  HELLO_MESSAGE_MAX,
  TURNSTILE_TOKEN_MAX,
])
