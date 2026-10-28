import { toFieldErrors, type FieldError } from './errors'
import {
  fieldsOf,
  type FieldDefinition,
  type FormShape,
  type StepDefinition,
  type StopReason,
} from './definition'
import { submissionSchema, type FormKind } from './runtime'

/**
 * A stored form as a page draws it (ADR-0010, A2): what `GET /api/forms/<slug>`
 * returns for an open form, and the pure logic the pages share for it. The
 * readers, actions, receipt, purpose and retention never leave the server.
 * Every word comes from the version's text and is always shown as text.
 */
export interface PublicForm {
  slug: string
  kind: FormKind
  version: number
  definition: FormShape
  /** The version's en-GB wording, by key (`textKeys` in `publish.ts`). */
  text: Readonly<Record<string, string>>
  /**
   * The form takes free text, so its page shows the safety note (SG6). Worked
   * out from the P3 purpose on the server, so the purpose itself never leaves
   * it (Ezra, #159).
   */
  safetyNote: boolean
}

export function toPublicForm(form: {
  slug: string
  kind: FormKind
  version: number
  definition: FormShape
  text: Readonly<Record<string, string>>
  purpose: { readonly freeText: boolean }
}): PublicForm {
  const { steps, aboutYou, note } = form.definition
  return {
    slug: form.slug,
    kind: form.kind,
    version: form.version,
    definition: { steps, aboutYou, note },
    text: form.text,
    safetyNote: form.purpose.freeText,
  }
}

/**
 * One page of a multi-step form: a stored step, "About you" (call name and
 * email) where the version puts it, and "Check and send" last.
 */
export type FlowStep =
  { kind: 'fields'; step: StepDefinition } | { kind: 'about_you' } | { kind: 'check' }

export function flowSteps(definition: Pick<FormShape, 'steps' | 'aboutYou'>): FlowStep[] {
  const steps: FlowStep[] = definition.steps.map((step) => ({ kind: 'fields', step }))
  steps.splice(definition.aboutYou, 0, { kind: 'about_you' })
  steps.push({ kind: 'check' })
  return steps
}

/** What someone has typed or chosen so far. Held in memory only. */
export interface FormDraft {
  /** Made once and kept across retries, so a retry is never stored twice. */
  submissionId: string
  callName: string
  email: string
  /** Answers by field id; an unanswered field is missing or empty. */
  values: Record<string, string>
}

export function createFormDraft(submissionId: string = crypto.randomUUID()): FormDraft {
  return { submissionId, callName: '', email: '', values: {} }
}

/** Empties a draft and gives it a new submission id, for Leave and after a send. */
export function clearFormDraft(draft: FormDraft, submissionId: string = crypto.randomUUID()): void {
  draft.submissionId = submissionId
  draft.callName = ''
  draft.email = ''
  draft.values = {}
}

/**
 * The ids of the fields shown for these answers, in order. A field with a
 * show-if condition is shown only while its trigger is shown and has one of
 * the listed answers, so a chain hides together.
 */
export function shownFieldIds(
  definition: Pick<FormShape, 'steps'>,
  values: Readonly<Record<string, string>>,
): Set<string> {
  const shown = new Set<string>()
  for (const { field } of fieldsOf(definition)) {
    const condition = field.showIf
    if (
      !condition ||
      (shown.has(condition.field) && condition.in.includes(values[condition.field] ?? ''))
    ) {
      shown.add(field.id)
    }
  }
  return shown
}

/** The request field name for a stored field: `checks.over_18`, or `message` at the top level. */
export function fieldPath(step: StepDefinition, field: FieldDefinition): string {
  return step.body === null ? field.id : `${step.body}.${field.id}`
}

/** The reason an answer ends the form, if a shown one does. */
export function stopReasonOf(
  definition: Pick<FormShape, 'steps'>,
  values: Readonly<Record<string, string>>,
): StopReason | undefined {
  const shown = shownFieldIds(definition, values)
  for (const { field } of fieldsOf(definition)) {
    if (field.type !== 'single_choice' || !shown.has(field.id)) continue
    const answer = values[field.id]
    const outcome = answer ? field.outcomes?.[answer] : undefined
    if (outcome && 'stop' in outcome) return outcome.stop
  }
  return undefined
}

/**
 * The request body, in the forms contract's order (docs/api/forms.md). Text
 * is trimmed; empty answers and the answers to hidden fields are left out,
 * so a hidden answer is never sent.
 */
export function toRequestBody(
  form: Pick<PublicForm, 'slug' | 'kind' | 'definition'>,
  draft: FormDraft,
  turnstileToken: string,
): Record<string, unknown> {
  const { definition } = form
  const shown = shownFieldIds(definition, draft.values)
  const body: Record<string, unknown> = { submissionId: draft.submissionId }
  if (form.kind === 'application') body.role = form.slug
  const aboutYou = () => {
    body.callName = draft.callName.trim()
    body.email = draft.email.trim()
  }
  definition.steps.forEach((step, index) => {
    if (index === definition.aboutYou) aboutYou()
    const answers: Record<string, string> = {}
    for (const field of step.fields) {
      const answer = (draft.values[field.id] ?? '').trim()
      if (answer && shown.has(field.id)) answers[field.id] = answer
    }
    if (step.body === null) Object.assign(body, answers)
    else body[step.body] = answers
  })
  if (definition.aboutYou === definition.steps.length) aboutYou()
  body.turnstileToken = turnstileToken
  return body
}

// Codes a person can fix by changing an answer. Stop reasons are handled by
// the stop page, and anything else means the page and the server disagree.
const FIXABLE = new Set<string>(['required', 'too_long', 'invalid_email', 'invalid_choice'])

const schemas = new WeakMap<FormShape, ReturnType<typeof submissionSchema>>()

/**
 * Problems with a draft, checked with the server's own run-time schema, so
 * the page and the API never disagree (#44). Pass `fields` (request field
 * names, such as `checks.over_18` or `callName`) to check only those, in the
 * order the form shows them.
 */
export function draftErrors(
  form: Pick<PublicForm, 'slug' | 'kind' | 'definition'>,
  draft: FormDraft,
  fields?: readonly string[],
): FieldError[] {
  let schema = schemas.get(form.definition)
  if (!schema) {
    schema = submissionSchema(form.definition, { kind: form.kind, slug: form.slug })
    schemas.set(form.definition, schema)
  }
  // A stand-in token: the real one is fetched only when sending.
  const body = toRequestBody(form, draft, 'pending')
  const result = schema.safeParse(body)
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, body)
  if (!mapped.ok) return []
  const order = fields ?? allFieldPaths(form.definition)
  return (
    mapped.errors
      .filter((error) => FIXABLE.has(error.code) && order.includes(error.field))
      // A choice nobody made is unanswered, not a wrong choice: the request
      // leaves it out, which the schema reports as a value outside the list.
      .map((error): FieldError => {
        const id = error.field.slice(error.field.lastIndexOf('.') + 1)
        return error.code === 'invalid_choice' && !draft.values[id]
          ? { field: error.field, code: 'required' }
          : error
      })
      .sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field))
  )
}

/** Every request field name a person fills in, in the order the form shows them. */
export function allFieldPaths(definition: Pick<FormShape, 'steps' | 'aboutYou'>): string[] {
  return flowSteps(definition).flatMap((flow) => flowFieldPaths(flow))
}

/** The request field names one page of the flow holds. */
export function flowFieldPaths(flow: FlowStep): string[] {
  if (flow.kind === 'about_you') return ['callName', 'email']
  if (flow.kind === 'check') return []
  return flow.step.fields.map((field) => fieldPath(flow.step, field))
}

/** The stored field a request field name points at, if any. */
export function fieldAt(
  definition: Pick<FormShape, 'steps'>,
  path: string,
): FieldDefinition | undefined {
  for (const step of definition.steps) {
    for (const field of step.fields) if (fieldPath(step, field) === path) return field
  }
  return undefined
}
