import { CALL_NAME_MAX, EMAIL_MAX, codePointLength, isPlausibleEmail } from '#shared/forms/fields'
import type { PublishedRole, StopReason } from '#shared/forms/roles'

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
  if (step === 2) {
    const callName = draft.callName.trim()
    if (!callName) errors.push({ field: 'callName', code: 'required' })
    else if (codePointLength(callName) > CALL_NAME_MAX) {
      errors.push({ field: 'callName', code: 'too_long' })
    }
    const email = draft.email.trim()
    if (!email) errors.push({ field: 'email', code: 'required' })
    else if (codePointLength(email) > EMAIL_MAX) errors.push({ field: 'email', code: 'too_long' })
    else if (!isPlausibleEmail(email)) errors.push({ field: 'email', code: 'invalid_email' })
  }
  if (step === 3) {
    for (const question of role.apply.questions) {
      const answer = (draft.answers[question.id] ?? '').trim()
      const field = `answers.${question.id}`
      if (!answer && question.required) errors.push({ field, code: 'required' })
      else if (codePointLength(answer) > question.maxLength) {
        errors.push({ field, code: 'too_long' })
      }
    }
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
  /** Show the error summary on the earliest step with a problem; keep every answer. */
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
      const step = Math.min(...errors.map((error) => stepForField(error.field))) as Step
      return { kind: 'invalid', step, errors }
    }
  }
  return { kind: 'failed' }
}

/**
 * The wording key for a field error, under `apply.errors`. Step 1 and step 3
 * questions share messages by type; call name and email have their own.
 */
export function errorMessageKey(error: FieldError, role: PublishedRole): string {
  if (error.field.startsWith('checks.')) {
    const check = role.apply.checks.find((item) => `checks.${item.id}` === error.field)
    return check?.type === 'confirm'
      ? 'apply.errors.confirm_required'
      : 'apply.errors.choice_required'
  }
  if (error.field.startsWith('answers.')) {
    return error.code === 'too_long'
      ? 'apply.errors.answer_too_long'
      : 'apply.errors.answer_required'
  }
  return `apply.errors.${error.field}.${error.code}`
}
