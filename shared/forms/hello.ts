import { z } from 'zod'
import { callName, email, submissionId, turnstileToken, text } from './fields'

/** Say hello: `POST /api/hello` (docs/api/forms.md, section 1). */
export const helloSchema = z.strictObject({
  submissionId,
  callName,
  email,
  message: text(2000),
  turnstileToken,
})

export type HelloSubmission = z.infer<typeof helloSchema>
