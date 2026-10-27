import { toFieldErrors } from '#shared/forms/errors'
import { CALL_NAME_MAX, EMAIL_MAX } from '#shared/forms/fields'
import { HELLO_MESSAGE_MAX, helloSchema } from '#shared/forms/hello'
import { TURNSTILE_FIELD, type ErrorMessage, type FieldError } from './apply-flow'

/**
 * The logic half of say hello (#14): checking what was typed with the API's
 * own schema, what to send and how to read the reply (docs/api/forms.md,
 * section 1). Held in memory only, like the apply flow.
 */
export interface HelloDraft {
  /** Made once when the form loads and kept across retries, so a retry is never stored twice. */
  submissionId: string
  callName: string
  email: string
  message: string
}

export function createHelloDraft(id: string = crypto.randomUUID()): HelloDraft {
  return { submissionId: id, callName: '', email: '', message: '' }
}

// The typed fields of the API's schema, so the page and the server agree (#44).
const typed = helloSchema.pick({ callName: true, email: true, message: true })

/** Problems with what was typed, in the order the fields appear. */
export function helloErrors(draft: HelloDraft): FieldError[] {
  const value = { callName: draft.callName, email: draft.email, message: draft.message }
  const result = typed.safeParse(value)
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, value)
  return mapped.ok ? mapped.errors : []
}

/** The body for `POST /api/hello`. The server trims text too. */
export function toHelloRequest(draft: HelloDraft, turnstileToken: string) {
  return {
    submissionId: draft.submissionId,
    callName: draft.callName.trim(),
    email: draft.email.trim(),
    message: draft.message.trim(),
    turnstileToken,
  }
}

/** What the page should do with the API's reply. */
export type HelloOutcome =
  | { kind: 'sent' }
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'turnstile_failed' }
  | { kind: 'rate_limited' }
  | { kind: 'failed' }

const FIELDS = new Set(['callName', 'email', 'message'])
// Codes a visitor can fix by changing what they typed. Anything else means
// the page and the server disagree, so it's shown as a failed send.
const FIXABLE = new Set(['required', 'too_long', 'invalid_email'])

export function readHelloResponse(status: number, body: unknown): HelloOutcome {
  if (status === 200 || status === 201) return { kind: 'sent' }
  const reply = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const errors = Array.isArray(reply.errors)
    ? reply.errors.filter(
        (error): error is FieldError =>
          typeof error?.field === 'string' && typeof error?.code === 'string',
      )
    : []
  if (status === 403 && errors.some((error) => error.code === 'turnstile_failed')) {
    return { kind: 'turnstile_failed' }
  }
  if (status === 429) return { kind: 'rate_limited' }
  if (
    status === 422 &&
    errors.length > 0 &&
    errors.every((error) => FIELDS.has(error.field) && FIXABLE.has(error.code))
  ) {
    return { kind: 'invalid', errors }
  }
  return { kind: 'failed' }
}

/** The wording for a field error, and the field's short name for the error summary. */
export function helloErrorMessage(error: FieldError): ErrorMessage {
  if (error.field === TURNSTILE_FIELD) {
    return { key: 'forms.turnstile.failed', params: {}, questionKey: 'hello.fields.spam_check' }
  }
  const max = { callName: CALL_NAME_MAX, email: EMAIL_MAX, message: HELLO_MESSAGE_MAX }[
    error.field as 'callName' | 'email' | 'message'
  ]
  return {
    key: `hello.errors.${error.field}.${error.code}`,
    params: error.code === 'too_long' ? { max } : {},
    questionKey: `hello.fields.${error.field}`,
  }
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** What was typed, as plain text, for "Copy my message" when a send fails. */
export function helloText(draft: HelloDraft, t: Translate): string {
  return [
    `${t('hello.fields.callName')}: ${draft.callName.trim()}`,
    `${t('hello.fields.email')}: ${draft.email.trim()}`,
    '',
    draft.message.trim(),
  ].join('\n')
}
