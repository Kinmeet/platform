import {
  LIMITS,
  bodyKeys,
  type BodyKey,
  type FieldDefinition,
  type FieldType,
  type FormDefinition,
  type StepDefinition,
} from '#shared/forms/definition'
import { textKeys } from '#shared/forms/publish'
import { purposes, type Purpose, type PurposeId } from '#shared/privacy/purposes'
import type { AdminFormDetail } from '#shared/admin'
import type { FormKind } from '#shared/forms/runtime'

/**
 * The form builder's working copy (ADR-0010, B3): pure helpers the builder
 * page uses to change a draft before it is saved. Nothing here decides what
 * can publish. The server's checks (`checkPublish`) do that, and the page
 * shows what they find. These helpers only keep the draft in a shape an
 * admin can go on editing: unique ids, one body key per step, and the
 * defaults each answer type needs.
 */

/** The draft as the builder edits it: en-GB text only, until Welsh is decided. */
export interface BuilderDraft {
  purpose: string
  definition: FormDefinition
  text: Record<string, string>
}

/** The purposes a form of this kind may use, in the reviewed list's order. */
export function purposesFor(kind: FormKind): { id: PurposeId; purpose: Purpose }[] {
  return (Object.entries(purposes) as [PurposeId, Purpose][])
    .filter(([, purpose]) => purpose.kind === kind)
    .map(([id, purpose]) => ({ id, purpose }))
}

/** A new form's first draft: one step with no questions, which the checks will point out. */
export function emptyDraft(kind: FormKind): BuilderDraft {
  const first = purposesFor(kind)[0]
  return {
    purpose: first?.id ?? '',
    definition: {
      steps: [{ id: 'step_1', body: null, fields: [] as unknown as StepDefinition['fields'] }],
      aboutYou: 0,
      note: false,
      receipt: 'none',
      actions: [],
      readers: first ? [...first.purpose.readers] : [],
    },
    text: {},
  }
}

/**
 * The draft to start editing from: the saved draft if there is one, then the
 * published version, then an empty form. Stored JSON is copied, so editing
 * never changes what the API returned.
 */
export function startingDraft(detail: AdminFormDetail): BuilderDraft {
  const source = detail.draft ?? detail.current
  if (!source) return emptyDraft(detail.form.kind)
  const text = (source.text as Record<string, Record<string, string>> | null)?.['en-GB'] ?? {}
  return structuredClone({
    purpose: source.purpose,
    definition: source.definition as FormDefinition,
    text: { ...text },
  })
}

/**
 * The body to save: every text key the definition no longer uses is left
 * out, so removing a question or a choice also removes its words.
 */
export function toSaveBody(draft: BuilderDraft) {
  const { required, optional } = textKeys(draft.definition)
  const text: Record<string, string> = {}
  for (const [key, value] of Object.entries(draft.text)) {
    if ((required.has(key) || optional.has(key)) && value.trim() !== '') text[key] = value
  }
  return { purpose: draft.purpose, definition: draft.definition, text: { 'en-GB': text } }
}

/** Every field id in the form. Ids are unique across the form, because answers are stored flat. */
function fieldIds(definition: FormDefinition): Set<string> {
  return new Set(definition.steps.flatMap((step) => step.fields.map((field) => field.id)))
}

/** The first `<prefix>_<n>` not already taken. */
function nextId(taken: Set<string>, prefix: string): string {
  for (let n = 1; ; n++) {
    const id = `${prefix}_${n}`
    if (!taken.has(id)) return id
  }
}

/** A field of this type with the defaults the type needs. */
export function newField(type: FieldType, id: string): FieldDefinition {
  switch (type) {
    case 'short_text':
      return { id, type, required: true, maxLength: LIMITS.maxLength.short_text }
    case 'long_text':
      return { id, type, required: true, maxLength: LIMITS.maxLength.long_text }
    case 'email':
    case 'call_name':
      return { id, type, required: true }
    case 'single_choice':
      return { id, type, required: true, choices: ['choice_1', 'choice_2'] }
    case 'confirm':
      return { id, type, required: true }
  }
}

/** Adds a short-text question to the end of a step and returns its id. */
export function addField(definition: FormDefinition, stepIndex: number): string | undefined {
  const step = definition.steps[stepIndex]
  if (!step || step.fields.length >= LIMITS.fieldsPerStep) return undefined
  const id = nextId(fieldIds(definition), 'question')
  step.fields.push(newField('short_text', id))
  return id
}

/** Removes a question, and any show-if condition that pointed at it. */
export function removeField(definition: FormDefinition, id: string): void {
  for (const step of definition.steps) {
    step.fields = step.fields.filter((field) => field.id !== id) as StepDefinition['fields']
    for (const field of step.fields) if (field.showIf?.field === id) delete field.showIf
  }
}

/**
 * Changes a question's answer type, keeping its id, words, required flag and
 * show-if condition. A confirm question is always required.
 */
export function changeType(definition: FormDefinition, id: string, type: FieldType): void {
  for (const step of definition.steps) {
    const index = step.fields.findIndex((field) => field.id === id)
    if (index === -1) continue
    const old = step.fields[index]!
    const next = newField(type, id)
    if (next.type !== 'confirm') next.required = old.required
    if (old.showIf) next.showIf = old.showIf
    if (next.type === 'single_choice' && old.type === 'single_choice') {
      next.choices = old.choices
      if (old.outcomes) next.outcomes = old.outcomes
    }
    step.fields[index] = next
    // Questions that showed only for one of this question's answers can't any more.
    if (type !== 'single_choice') {
      for (const each of definition.steps)
        for (const field of each.fields) if (field.showIf?.field === id) delete field.showIf
    }
  }
}

/**
 * Moves a question up or down within its step. Returns its new position,
 * counted from 1, or `undefined` if it can't move that way.
 */
export function moveField(
  definition: FormDefinition,
  id: string,
  by: -1 | 1,
): { step: number; position: number; count: number } | undefined {
  for (const [s, step] of definition.steps.entries()) {
    const index = step.fields.findIndex((field) => field.id === id)
    if (index === -1) continue
    const target = index + by
    if (target < 0 || target >= step.fields.length) return undefined
    const [field] = step.fields.splice(index, 1)
    step.fields.splice(target, 0, field!)
    return { step: s + 1, position: target + 1, count: step.fields.length }
  }
  return undefined
}

/** The body keys still free for a new step: each step must use a different one. */
export function freeBodies(definition: FormDefinition): (BodyKey | null)[] {
  const used = new Set(definition.steps.map((step) => step.body))
  return [null, ...bodyKeys].filter((body) => !used.has(body))
}

/** Adds a step with one short-text question. Returns the new step's number, from 1. */
export function addStep(definition: FormDefinition): number | undefined {
  const body = freeBodies(definition)[0]
  if (body === undefined || definition.steps.length >= LIMITS.steps) return undefined
  const taken = new Set(definition.steps.map((step) => step.id))
  const id = body ?? nextId(taken, 'step')
  const field = newField('short_text', nextId(fieldIds(definition), 'question'))
  definition.steps.push({ id, body, fields: [field] })
  return definition.steps.length
}

/** Removes a step and its questions. "About you" stays where it was, or moves to the end. */
export function removeStep(definition: FormDefinition, stepIndex: number): void {
  const step = definition.steps[stepIndex]
  if (!step || definition.steps.length === 1) return
  for (const field of step.fields) removeField(definition, field.id)
  definition.steps.splice(stepIndex, 1)
  definition.aboutYou = Math.min(definition.aboutYou, definition.steps.length)
}

/** Adds a choice to a one-choice question. Returns the new choice's id. */
export function addChoice(field: FieldDefinition): string | undefined {
  if (field.type !== 'single_choice' || field.choices.length >= LIMITS.choicesMax) return undefined
  const id = nextId(new Set(field.choices), 'choice')
  field.choices.push(id)
  return id
}

/** Removes a choice, with its outcome and any show-if condition's use of it. */
export function removeChoice(definition: FormDefinition, field: FieldDefinition, choice: string) {
  if (field.type !== 'single_choice' || field.choices.length <= LIMITS.choicesMin) return
  field.choices = field.choices.filter((each) => each !== choice)
  if (field.outcomes) {
    const outcomes = Object.fromEntries(
      Object.entries(field.outcomes).filter(([each]) => each !== choice),
    )
    if (Object.keys(outcomes).length) field.outcomes = outcomes
    else delete field.outcomes
  }
  for (const step of definition.steps) {
    for (const other of step.fields) {
      if (other.showIf?.field !== field.id) continue
      other.showIf.in = other.showIf.in.filter((each) => each !== choice)
      if (other.showIf.in.length === 0) delete other.showIf
    }
  }
}

/** Moves a choice up or down. Returns its new position from 1, or `undefined`. */
export function moveChoice(field: FieldDefinition, choice: string, by: -1 | 1) {
  if (field.type !== 'single_choice') return undefined
  const index = field.choices.indexOf(choice)
  const target = index + by
  if (index === -1 || target < 0 || target >= field.choices.length) return undefined
  field.choices.splice(index, 1)
  field.choices.splice(target, 0, choice)
  return target + 1
}

/** The one-choice questions before this one, which a show-if condition may look at. */
export function showIfTargets(definition: FormDefinition, id: string): FieldDefinition[] {
  const targets: FieldDefinition[] = []
  for (const step of definition.steps) {
    for (const field of step.fields) {
      if (field.id === id) return targets
      if (field.type === 'single_choice') targets.push(field)
    }
  }
  return targets
}

/** Finds a question by id. */
export function findBuilderField(
  definition: FormDefinition,
  id: string,
): { field: FieldDefinition; stepIndex: number; index: number } | undefined {
  for (const [stepIndex, step] of definition.steps.entries()) {
    const index = step.fields.findIndex((field) => field.id === id)
    if (index !== -1) return { field: step.fields[index]!, stepIndex, index }
  }
  return undefined
}

/**
 * The element id a problem's path points at on the builder page, so the
 * checks can link to the thing to fix. Text keys link to their input,
 * anything about a question to its Edit button, everything else to the
 * settings.
 */
export function problemTarget(definition: FormDefinition, path: string): string {
  const text = /^text\.en-GB\.(.+)$/.exec(path)?.[1]
  if (text) {
    const field = /^fields\.([^.]+)\./.exec(text)?.[1]
    if (field) return `edit-${field}`
    return textInputId(text)
  }
  const index = /^definition\.steps\.(\d+)\.fields\.(\d+)/.exec(path)
  if (index) {
    const field = definition.steps[Number(index[1])]?.fields[Number(index[2])]
    if (field) return `edit-${field.id}`
  }
  const step = /^definition\.steps\.(\d+)/.exec(path)
  if (step) return `step-${Number(step[1]) + 1}`
  const named = /^definition\.fields\.([^.]+)/.exec(path)?.[1]
  if (named) return `edit-${named}`
  if (path === 'purpose' || path === 'definition' || path.startsWith('definition.'))
    return 'settings-heading'
  return 'questions-heading'
}

/** The input id for a piece of form-level text, such as `title` or `steps.step_1.heading`. */
export function textInputId(key: string): string {
  return `text-${key.replaceAll('.', '-')}`
}

/** Problem codes the builder has words for. Any other code is shown as itself, never hidden. */
export const knownProblems = new Set([
  'action_not_allowed',
  'body_cap_over_route_limit',
  'body_cap_too_large',
  'definition_too_large',
  'duplicate_choice_text',
  'duplicate_label',
  'duplicate_summary',
  'field_type_not_allowed',
  'free_text_not_allowed',
  'hint_repeats_label',
  'locale_missing',
  'locale_not_allowed',
  'purpose_kind',
  'purpose_unknown',
  'reader_not_allowed',
  'receipt_not_allowed',
  'retention_too_long',
  'safeguarding_action_missing',
  'second_approval_needed',
  'slug_invalid',
  'slug_reserved',
  'summary_too_short',
  'text_empty',
  'text_missing',
  'text_shape',
  'text_too_large',
  'text_too_long',
  'text_unknown_key',
  'vague_link_text',
  'banned_term',
  'us_spelling',
  'asks_for_credentials',
  // From the definition's own shape (`definitionSchema`).
  'about_you_position',
  'duplicate_action',
  'duplicate_reader',
  'duplicate_step',
  'duplicate_body',
  'duplicate_field',
  'duplicate_choice',
  'unknown_choice',
  'every_choice_stops',
  'show_if_target',
  'show_if_choice',
  'show_if_not_next',
  'reserved_id',
  'link_not_allowed',
  'definition_too_small',
  'definition_too_big',
])

type Translate = (key: string, params?: Record<string, unknown>) => string

/** How long a form's submissions are kept, in words, from its P3 row and retention. */
export function keptFor(p3Row: string | null, months: number | null, t: Translate): string {
  const purpose = Object.values(purposes).find((each) => each.p3Row === p3Row)
  if (!purpose || months === null) return t('admin.forms.kept.none')
  return t(`admin.forms.kept.${purpose.retention.base}`, { months, row: purpose.p3Row })
}

const listFormat = new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' })

/** P4 roles as a list in words, such as "Central team and Secretary". */
export function readerList(roles: readonly string[], t: Translate): string {
  if (!roles.length) return t('admin.forms.readers.none')
  return listFormat.format(roles.map((role) => t(`admin.roles.${role}`)))
}
