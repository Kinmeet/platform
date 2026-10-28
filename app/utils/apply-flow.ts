import { CALL_NAME_MAX, EMAIL_MAX } from '#shared/forms/fields'
import type { StopReason } from '#shared/forms/definition'
import {
  allFieldPaths,
  clearFormDraft,
  createFormDraft,
  draftErrors,
  fieldAt,
  flowFieldPaths,
  flowSteps,
  shownFieldIds,
  stopReasonOf,
  toRequestBody,
  type FlowStep,
  type FormDraft,
  type PublicForm,
} from '#shared/forms/view'

/**
 * The logic half of a multi-step form, such as a role application (#21,
 * ADR-0010): what has been answered, which step may be shown, what to send
 * and how to read the reply. Every step comes from the stored version
 * (`GET /api/forms/<slug>`). The step pages keep a draft in memory only and
 * call these. Nothing here touches storage.
 */

/** A step number, from 1. */
export type Step = number

export type ApplicationDraft = FormDraft

/** A problem with one field, named as the API names it. */
export interface FieldError {
  field: string
  code: string
}

export function createDraft(
  _form: PublicForm,
  submissionId: string = crypto.randomUUID(),
): ApplicationDraft {
  return createFormDraft(submissionId)
}

/**
 * Empties a draft, for Leave and after a successful send. It gets a new
 * submission id, because the contract keeps one id until a send succeeds.
 */
export const clearDraft = clearFormDraft

/** The form's pages, in order: its steps, "About you", then "Check and send". */
export function stepsOf(form: PublicForm): FlowStep[] {
  return flowSteps(form.definition)
}

/** The page a step number shows. */
export function flowStepAt(form: PublicForm, step: Step): FlowStep {
  const steps = stepsOf(form)
  return steps[Math.min(Math.max(step, 1), steps.length) - 1]!
}

/** The reason the flow must stop, if a shown answer stops it. */
export function stopReason(draft: ApplicationDraft, form: PublicForm): StopReason | undefined {
  return stopReasonOf(form.definition, draft.values)
}

/** The step that holds the answer that stops the flow. */
function stopStep(draft: ApplicationDraft, form: PublicForm): Step | undefined {
  if (!stopReason(draft, form)) return undefined
  const steps = stepsOf(form)
  const index = steps.findIndex(
    (flow) =>
      flow.kind === 'fields' &&
      flow.step.fields.some((field) => {
        if (field.type !== 'single_choice') return false
        const answer = draft.values[field.id]
        const outcome = answer ? field.outcomes?.[answer] : undefined
        return outcome !== undefined && 'stop' in outcome
      }),
  )
  return index + 1
}

/** Problems with one step's answers, in the order the fields appear. */
export function stepErrors(draft: ApplicationDraft, form: PublicForm, step: Step): FieldError[] {
  const paths = flowFieldPaths(flowStepAt(form, step))
  return paths.length ? draftErrors(form, draft, paths) : []
}

/**
 * The furthest step that may be shown: the first one not yet complete, or
 * "Check and send" once all are. A stopped flow never gets past the step
 * with the answer that stops it.
 */
export function furthestStep(draft: ApplicationDraft, form: PublicForm): Step {
  const stopped = stopStep(draft, form)
  if (stopped) return stopped
  const count = stepsOf(form).length
  for (let step = 1; step < count; step++) {
    if (stepErrors(draft, form, step).length > 0) return step
  }
  return count
}

/**
 * The step to show for a requested one. A later step can't be opened before
 * the earlier ones are done, for example by typing `?step=4`. A reload starts
 * again at step 1, because the draft lives only in memory.
 */
export function allowedStep(requested: unknown, draft: ApplicationDraft, form: PublicForm): Step {
  // Only a plain string counts: `?step=2&step=2` arrives as an array.
  const asked = typeof requested === 'string' && requested !== '' ? Number(requested) : 1
  const count = stepsOf(form).length
  const step = Number.isInteger(asked) && asked >= 1 && asked <= count ? asked : 1
  return Math.min(step, furthestStep(draft, form))
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
  form: PublicForm,
): RedirectReason | undefined {
  const allowed = allowedStep(requested, draft, form)
  if (requested === undefined || String(requested) === String(allowed)) return undefined
  if (stopReason(draft, form)) return undefined
  const nothing =
    !draft.callName && !draft.email && Object.values(draft.values).every((value) => !value)
  return furthestStep(draft, form) === 1 && nothing ? 'restarted' : 'earlier_step'
}

/** The step that holds a field, so a server error can send the visitor back to it. */
export function stepForField(field: string, form: PublicForm): Step {
  const steps = stepsOf(form)
  const index = steps.findIndex((flow) => flowFieldPaths(flow).includes(field))
  return index === -1 ? steps.length : index + 1
}

/** The body for `POST /api/apply`. Text is trimmed; empty and hidden answers are left out. */
export function toRequest(draft: ApplicationDraft, form: PublicForm, turnstileToken: string) {
  return toRequestBody(form, draft, turnstileToken)
}

/** The request field for the spam check token, which the server names in its 403. */
export const TURNSTILE_FIELD = 'turnstileToken'

/**
 * Why Send didn't work, for "That didn't send" with Copy my answers (#17):
 * our end failed, too many tries, or the spam check couldn't load.
 */
export type SendProblem = 'unavailable' | 'rate_limited' | 'spam_check'

/** Whether Services queued the receipt email (docs/api/forms.md). */
export type Receipt = 'queued' | 'not_requested'

/** What the page should do with the API's reply (docs/api/forms.md, "Responses"). */
export type SendOutcome =
  | { kind: 'sent'; receipt: Receipt }
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

export function isFieldError(value: unknown): value is FieldError {
  if (typeof value !== 'object' || value === null) return false
  const { field, code } = value as Record<string, unknown>
  return typeof field === 'string' && typeof code === 'string'
}

export function readSendResponse(status: number, body: unknown, form: PublicForm): SendOutcome {
  const reply = (typeof body === 'object' && body !== null ? body : {}) as Record<string, unknown>
  // Only claim a receipt was emailed when the server says so.
  if (status === 200 || status === 201) {
    return { kind: 'sent', receipt: reply.receipt === 'queued' ? 'queued' : 'not_requested' }
  }
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
    const known = allFieldPaths(form.definition)
    if (errors.every((error) => FIXABLE.has(error.code) && known.includes(error.field))) {
      // Only the errors on that step: each summary item must link to a field
      // on the page being shown. Later ones are caught again further on.
      const step = Math.min(...errors.map((error) => stepForField(error.field, form)))
      return {
        kind: 'invalid',
        step,
        errors: errors.filter((error) => stepForField(error.field, form) === step),
      }
    }
  }
  return { kind: 'failed' }
}

/** A question's short name for the error summary: fixed copy, or the version's own words. */
export type QuestionName = { key: string } | { text: string }

/** How to word one field error: the message and, for the error summary, its question. */
export interface ErrorMessage {
  /** The message under the field, from the fixed copy. Admins never write error text. */
  key: string
  params: Record<string, number>
  /** The question's short name, for `apply.errors.summary_item`. */
  question: QuestionName
}

/**
 * The wording for a field error on an application. Messages are fixed and
 * shared by field type, so the error summary names the question in each
 * item (Robin, #78), with the field's own summary from the version:
 * `t('apply.errors.summary_item', { question, message: t(key, params) })`.
 */
export function errorMessage(error: FieldError, form: PublicForm): ErrorMessage {
  // The spam check isn't a question; its summary item links to Send (#17).
  if (error.field === TURNSTILE_FIELD) {
    return {
      key: 'forms.turnstile.failed',
      params: {},
      question: { key: 'apply.fields.spam_check' },
    }
  }
  const field = fieldAt(form.definition, error.field)
  if (!field) {
    const params: Record<string, number> =
      error.code === 'too_long' ? { max: error.field === 'email' ? EMAIL_MAX : CALL_NAME_MAX } : {}
    return {
      key: `apply.errors.${error.field}.${error.code}`,
      params,
      question: { key: `apply.fields.${error.field}` },
    }
  }
  const question = { text: form.text[`fields.${field.id}.summary`] ?? '' }
  switch (field.type) {
    case 'confirm':
      return { key: 'apply.errors.confirm_required', params: {}, question }
    case 'single_choice':
      return { key: 'apply.errors.choice_required', params: {}, question }
    case 'email':
    case 'call_name': {
      const name = field.type === 'email' ? 'email' : 'callName'
      return {
        key: `apply.errors.${name}.${error.code}`,
        params:
          error.code === 'too_long'
            ? { max: field.type === 'email' ? EMAIL_MAX : CALL_NAME_MAX }
            : {},
        question,
      }
    }
    default:
      return error.code === 'too_long'
        ? { key: 'apply.errors.answer_too_long', params: { max: field.maxLength }, question }
        : { key: 'apply.errors.answer_required', params: {}, question }
  }
}

type Translate = (key: string, params?: Record<string, unknown>) => string

/** The words for a fixed key or a version's own words. */
export function questionText(question: QuestionName, t: Translate): string {
  return 'text' in question ? question.text : t(question.key)
}

/** A step's heading (Robin, #158): fixed for checks, "About you", answers and "Check and send". */
export function stepTitle(form: PublicForm, flow: FlowStep, t: Translate): string {
  if (flow.kind === 'about_you') return t('apply.steps.2')
  if (flow.kind === 'check') return t('apply.steps.4')
  if (flow.step.body === 'checks') return t('apply.steps.1')
  if (flow.step.body === 'answers') return t('apply.steps.3')
  return form.text[`steps.${flow.step.id}.heading`] ?? form.text.title ?? ''
}

/** The words for one answer, as Check and send shows it, or undefined if there's none. */
export function answerText(form: PublicForm, id: string, answer: string | undefined) {
  const value = answer?.trim()
  if (!value) return undefined
  const field = findField(form, id)
  if (field?.type === 'single_choice' || field?.type === 'confirm') {
    return form.text[`fields.${id}.choices.${value}`] ?? value
  }
  return value
}

function findField(form: PublicForm, id: string) {
  for (const step of form.definition.steps) {
    const field = step.fields.find((item) => item.id === id)
    if (field) return field
  }
  return undefined
}

/**
 * Every answer as plain text, for "Copy my answers" when a send fails (#17).
 * Laid out like Check and send, so it reads well pasted into a note or an
 * email. It names no Kinmeet address: there's no domain yet.
 */
export function answersText(draft: ApplicationDraft, form: PublicForm, t: Translate): string {
  const none = t('apply.no_answer')
  const line = (label: string, value: string | undefined) => `${label}: ${value?.trim() || none}`
  const shown = shownFieldIds(form.definition, draft.values)
  const lines = [t('apply.applying_for', { role: form.text.title ?? '' })]
  for (const flow of stepsOf(form)) {
    if (flow.kind === 'check') continue
    lines.push('', stepTitle(form, flow, t))
    if (flow.kind === 'about_you') {
      lines.push(line(t('apply.fields.callName'), draft.callName))
      lines.push(line(t('apply.fields.email'), draft.email))
      continue
    }
    for (const field of flow.step.fields) {
      if (!shown.has(field.id)) continue
      lines.push(
        line(
          form.text[`fields.${field.id}.summary`] ?? field.id,
          answerText(form, field.id, draft.values[field.id]),
        ),
      )
    }
  }
  return lines.join('\n')
}
