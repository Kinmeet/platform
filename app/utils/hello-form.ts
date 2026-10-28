import { CALL_NAME_MAX, EMAIL_MAX } from '#shared/forms/fields'
import {
  allFieldPaths,
  createFormDraft,
  draftErrors,
  fieldAt,
  shownFieldIds,
  toRequestBody,
  type FormDraft,
  type PublicForm,
} from '#shared/forms/view'
import {
  TURNSTILE_FIELD,
  answerText,
  isFieldError,
  type ErrorMessage,
  type FieldError,
} from './apply-flow'

/**
 * The logic half of a one-page form, such as say hello (#14, ADR-0010):
 * checking what was typed with the API's own run-time schema for the stored
 * version, what to send and how to read the reply (docs/api/forms.md,
 * section 1). Held in memory only, like the apply flow.
 */
export type HelloDraft = FormDraft

export function createHelloDraft(id: string = crypto.randomUUID()): HelloDraft {
  return createFormDraft(id)
}

/** Problems with what was typed, in the order the fields appear. */
export function helloErrors(draft: HelloDraft, form: PublicForm): FieldError[] {
  return draftErrors(form, draft)
}

/** The body for `POST /api/<form>`. The server trims text too. */
export function toHelloRequest(draft: HelloDraft, form: PublicForm, turnstileToken: string) {
  return toRequestBody(form, draft, turnstileToken)
}

/** What the page should do with the API's reply. */
export type HelloOutcome =
  | { kind: 'sent' }
  | { kind: 'invalid'; errors: FieldError[] }
  | { kind: 'turnstile_failed' }
  | { kind: 'rate_limited' }
  | { kind: 'failed' }

// Codes a visitor can fix by changing what they typed. Anything else means
// the page and the server disagree, so it's shown as a failed send.
const FIXABLE = new Set(['required', 'too_long', 'invalid_email', 'invalid_choice'])

export function readHelloResponse(status: number, body: unknown, form: PublicForm): HelloOutcome {
  if (status === 200 || status === 201) return { kind: 'sent' }
  const reply = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const errors = Array.isArray(reply.errors) ? reply.errors.filter(isFieldError) : []
  if (status === 403 && errors.some((error) => error.code === 'turnstile_failed')) {
    return { kind: 'turnstile_failed' }
  }
  if (status === 429) return { kind: 'rate_limited' }
  const known = allFieldPaths(form.definition)
  if (
    status === 422 &&
    errors.length > 0 &&
    errors.every((error) => known.includes(error.field) && FIXABLE.has(error.code))
  ) {
    return { kind: 'invalid', errors }
  }
  return { kind: 'failed' }
}

/**
 * The wording for a field error, and the field's short name for the error
 * summary. "About you" keeps say hello's own messages; a stored field gets
 * the fixed message for its type, and admins never write error text.
 */
export function helloErrorMessage(error: FieldError, form: PublicForm): ErrorMessage {
  if (error.field === TURNSTILE_FIELD) {
    return {
      key: 'forms.turnstile.failed',
      params: {},
      question: { key: 'hello.fields.spam_check' },
    }
  }
  const field = fieldAt(form.definition, error.field)
  const max = (name: 'callName' | 'email') => (name === 'email' ? EMAIL_MAX : CALL_NAME_MAX)
  if (!field) {
    const name = error.field as 'callName' | 'email'
    return {
      key: `hello.errors.${name}.${error.code}`,
      params: error.code === 'too_long' ? { max: max(name) } : {},
      question: { key: `hello.fields.${name}` },
    }
  }
  const question = { text: form.text[`fields.${field.id}.summary`] ?? '' }
  switch (field.type) {
    case 'confirm':
      return { key: 'forms.errors.confirm_required', params: {}, question }
    case 'single_choice':
      return { key: 'forms.errors.choice_required', params: {}, question }
    case 'email':
    case 'call_name': {
      const name = field.type === 'email' ? 'email' : 'callName'
      return {
        key: `hello.errors.${name}.${error.code}`,
        params: error.code === 'too_long' ? { max: max(name) } : {},
        question,
      }
    }
    default:
      return error.code === 'too_long'
        ? { key: 'forms.errors.text_too_long', params: { max: field.maxLength }, question }
        : { key: 'forms.errors.text_required', params: {}, question }
  }
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** What was typed, as plain text, for "Copy my message" when a send fails. */
export function helloText(draft: HelloDraft, form: PublicForm, t: Translate): string {
  const shown = shownFieldIds(form.definition, draft.values)
  const answers = form.definition.steps
    .flatMap((step) => step.fields)
    .filter((field) => shown.has(field.id))
    .map((field) => answerText(form, field.id, draft.values[field.id]) ?? '')
  return [
    `${t('hello.fields.callName')}: ${draft.callName.trim()}`,
    `${t('hello.fields.email')}: ${draft.email.trim()}`,
    '',
    ...answers,
  ].join('\n')
}
