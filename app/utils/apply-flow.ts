import { z } from 'zod'
import { toFieldErrors } from '#shared/forms/errors'
import {
  CALL_NAME_MAX,
  EMAIL_MAX,
  callName,
  codePointLength,
  email,
  text,
} from '#shared/forms/fields'
import { roleKey, type PublishedRole, type StopReason } from '#shared/forms/roles'

/**
 * The logic half of the apply flow (#21): what has been answered, which step
 * may be shown, what to send and how to read the reply. The step pages (#15)
 * keep a draft in memory only and call these. Nothing here touches storage.
 */

export const STEPS = [1, 2, 3, 4] as const
export type Step = (typeof STEPS)[number]

export interface ApplicationDraft {
  role: string
  /** Made once when the flow starts and sent with every attempt (contract). */
  submissionId: string
  checks: Record<string, string>
  callName: string
  email: string
  answers: Record<string, string>
}

/** A problem with one field, named as the API names it. */
export interface FieldError {
  field: string
  code: string
}

export function createDraft(
  role: PublishedRole,
  submissionId: string = crypto.randomUUID(),
): ApplicationDraft {
  return { role: role.slug, submissionId, checks: {}, callName: '', email: '', answers: {} }
}

/**
 * Empties a draft, for Leave and after a successful send. It gets a new
 * submission id, because the contract keeps one id until a send succeeds.
 */
export function clearDraft(
  draft: ApplicationDraft,
  submissionId: string = crypto.randomUUID(),
): void {
  draft.submissionId = submissionId
  draft.checks = {}
  draft.callName = ''
  draft.email = ''
  draft.answers = {}
}

/** The reason the flow must stop at step 1, if a check answer stops it. */
export function stopReason(draft: ApplicationDraft, role: PublishedRole): StopReason | undefined {
  for (const check of role.apply.checks) {
    if (check.type !== 'single_choice' || !check.outcomes) continue
    const answer = draft.checks[check.id]
    const outcome = answer ? check.outcomes[answer] : undefined
    if (outcome && 'stop' in outcome) return outcome.stop
  }
  return undefined
}

// Step 2's fields, checked with the same schemas as the API (#44).
const aboutYou = z.object({ callName, email })

/** An optional answer: empty is fine, otherwise the same rule as a required one. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .refine((value) => codePointLength(value) <= max, { params: { code: 'too_long' } })
}

/** The schema's problems as field errors, in field order. */
function schemaErrors(schema: z.ZodType, value: unknown): FieldError[] {
  const result = schema.safeParse(value)
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, value)
  return mapped.ok ? mapped.errors : []
}

/** Problems with one step's answers, in the order the fields appear. */
export function stepErrors(draft: ApplicationDraft, role: PublishedRole, step: Step): FieldError[] {
  const errors: FieldError[] = []
  if (step === 1) {
    for (const check of role.apply.checks) {
      const answer = draft.checks[check.id]
      const field = `checks.${check.id}`
      if (!answer) errors.push({ field, code: 'required' })
      else if (!(check.choices as readonly string[]).includes(answer)) {
        errors.push({ field, code: 'invalid_choice' })
      }
    }
  }
  if (step === 2) errors.push(...schemaErrors(aboutYou, draft))
  if (step === 3) {
    // The server's own rules (#44), so the page and the API never disagree.
    const answers = z.object(
      Object.fromEntries(
        role.apply.questions.map((question) => [
          question.id,
          question.required ? text(question.maxLength) : optionalText(question.maxLength),
        ]),
      ),
    )
    const values = Object.fromEntries(
      role.apply.questions.map((question) => [question.id, draft.answers[question.id] ?? '']),
    )
    errors.push(
      ...schemaErrors(answers, values).map((error) => ({
        ...error,
        field: `answers.${error.field}`,
      })),
    )
  }
  return errors
}

/**
 * The furthest step that may be shown: the first one not yet complete, or
 * step 4 once all are. A stopped flow never gets past step 1.
 */
export function furthestStep(draft: ApplicationDraft, role: PublishedRole): Step {
  if (stopReason(draft, role)) return 1
  for (const step of [1, 2, 3] as const) {
    if (stepErrors(draft, role, step).length > 0) return step
  }
  return 4
}

/**
 * The step to show for a requested one. A later step can't be opened before
 * the earlier ones are done, for example by typing `?step=4`. A reload starts
 * again at step 1, because the draft lives only in memory.
 */
export function allowedStep(
  requested: unknown,
  draft: ApplicationDraft,
  role: PublishedRole,
): Step {
  // Only a plain string counts: `?step=2&step=2` arrives as an array.
  const asked = typeof requested === 'string' && requested !== '' ? Number(requested) : 1
  const step: Step = (STEPS as readonly number[]).includes(asked) ? (asked as Step) : 1
  return Math.min(step, furthestStep(draft, role)) as Step
}

/**
 * Why the guard showed a different step from the one asked for, so the page
 * can say so (Robin, #78). `restarted` means nothing is answered yet, which
 * is what a reload looks like; `earlier_step` means a step before it isn't
 * done. A stopped flow needs no reason: the stop message says it.
 */
export type RedirectReason = 'restarted' | 'earlier_step'

export function redirectReason(
  requested: unknown,
  draft: ApplicationDraft,
  role: PublishedRole,
): RedirectReason | undefined {
  const allowed = allowedStep(requested, draft, role)
  if (requested === undefined || String(requested) === String(allowed)) return undefined
  if (stopReason(draft, role)) return undefined
  return furthestStep(draft, role) === 1 && Object.keys(draft.checks).length === 0
    ? 'restarted'
    : 'earlier_step'
}

/** The step that holds a field, so a server error can send the visitor back to it. */
export function stepForField(field: string): Step {
  if (field.startsWith('checks.')) return 1
  if (field === 'callName' || field === 'email') return 2
  if (field.startsWith('answers.')) return 3
  return 4
}

/** The body for `POST /api/apply`. Text is trimmed; empty optional answers are left out. */
export function toRequest(draft: ApplicationDraft, role: PublishedRole, turnstileToken: string) {
  const checks: Record<string, string> = {}
  for (const check of role.apply.checks) {
    const answer = draft.checks[check.id]
    if (answer) checks[check.id] = answer
  }
  const answers: Record<string, string> = {}
  for (const question of role.apply.questions) {
    const answer = (draft.answers[question.id] ?? '').trim()
    if (answer) answers[question.id] = answer
  }
  return {
    submissionId: draft.submissionId,
    role: draft.role,
    checks,
    callName: draft.callName.trim(),
    email: draft.email.trim(),
    answers,
    turnstileToken,
  }
}

/** What the page should do with the API's reply (docs/api/forms.md, "Responses"). */
export type SendOutcome =
  | { kind: 'sent' }
  /** Show the error summary on the earliest step with a problem, with that step's errors only; keep every answer. */
  | { kind: 'invalid'; step: Step; errors: FieldError[] }
  /** End on the stop page. The page stops first; this is the server's backstop. */
  | { kind: 'stopped'; reason: StopReason }
  /** Reset the spam check and ask to try again. */
  | { kind: 'turnstile_failed' }
  | { kind: 'rate_limited'; retryAfter: number }
  /** Show "That didn't send", with Copy my answers. */
  | { kind: 'failed' }

// Codes a visitor can fix by changing an answer. Any other code (unknown_field,
// unknown_role, role_closed) means the page and the server disagree, so it is
// shown as a failed send rather than blamed on the visitor.
const FIXABLE = new Set(['required', 'too_long', 'invalid_email', 'invalid_choice'])
const STOPS = new Set<string>(['under_18', 'not_independent'])

function isFieldError(value: unknown): value is FieldError {
  if (typeof value !== 'object' || value === null) return false
  const { field, code } = value as Record<string, unknown>
  return typeof field === 'string' && typeof code === 'string'
}

export function readSendResponse(status: number, body: unknown): SendOutcome {
  if (status === 200 || status === 201) return { kind: 'sent' }
  const reply = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  const errors = Array.isArray(reply.errors) ? reply.errors.filter(isFieldError) : []

  if (status === 403 && errors.some((error) => error.code === 'turnstile_failed')) {
    return { kind: 'turnstile_failed' }
  }
  if (status === 429) {
    const retryAfter =
      typeof reply.retryAfter === 'number' && reply.retryAfter > 0 ? reply.retryAfter : 60
    return { kind: 'rate_limited', retryAfter }
  }
  if (status === 422 && errors.length > 0) {
    const stop = errors.find((error) => STOPS.has(error.code))
    if (stop) return { kind: 'stopped', reason: stop.code as StopReason }
    if (errors.every((error) => FIXABLE.has(error.code))) {
      // Only the errors on that step: each summary item must link to a field
      // on the page being shown. Later ones are caught again further on.
      const step = Math.min(...errors.map((error) => stepForField(error.field))) as Step
      return {
        kind: 'invalid',
        step,
        errors: errors.filter((error) => stepForField(error.field) === step),
      }
    }
  }
  return { kind: 'failed' }
}

/** How to word one field error: the message and, for the error summary, its question. */
export interface ErrorMessage {
  /** The message under the field, under `apply.errors`. */
  key: string
  params: Record<string, number>
  /** The question's short label, for `apply.errors.summary_item`. */
  questionKey: string
}

/**
 * The wording for a field error. Step 1 and step 3 messages are shared by
 * type, so the error summary names the question in each item (Robin, #78):
 * `t('apply.errors.summary_item', { question: t(questionKey), message: t(key, params) })`.
 */
export function errorMessage(error: FieldError, role: PublishedRole): ErrorMessage {
  const id = error.field.slice(error.field.indexOf('.') + 1)
  const questionKey = `${roleKey(role.slug)}.questions.${id}.summary`
  if (error.field.startsWith('checks.')) {
    const check = role.apply.checks.find((item) => item.id === id)
    return {
      key:
        check?.type === 'confirm'
          ? 'apply.errors.confirm_required'
          : 'apply.errors.choice_required',
      params: {},
      questionKey,
    }
  }
  if (error.field.startsWith('answers.')) {
    const question = role.apply.questions.find((item) => item.id === id)
    return error.code === 'too_long'
      ? {
          key: 'apply.errors.answer_too_long',
          params: { max: question?.maxLength ?? 0 },
          questionKey,
        }
      : { key: 'apply.errors.answer_required', params: {}, questionKey }
  }
  const params: Record<string, number> =
    error.code === 'too_long' ? { max: error.field === 'email' ? EMAIL_MAX : CALL_NAME_MAX } : {}
  return {
    key: `apply.errors.${error.field}.${error.code}`,
    params,
    questionKey: `apply.fields.${error.field}`,
  }
}
