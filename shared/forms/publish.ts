import { bannedTerms } from '../copy/banned-terms'
import { findPurpose, type Purpose } from '../privacy/purposes'
import {
  FORM_BODY_CAP_MAX,
  LIMITS,
  definitionSchema,
  fieldsOf,
  freeTextTypes,
  type FormDefinition,
} from './definition'
import { bodyCapFor, type FormKind } from './runtime'

/**
 * The checks a form version must pass before it is published (ADR-0010).
 * Publishing changes the live site without a code release, so these hold
 * every rule a reviewer used to check per form: the limits, the P3 purpose,
 * the P4 readers, SG6, the body cap and the copy rules. Problems are codes
 * with a path, never free text, so admins only ever see our fixed wording.
 *
 * Phase 1 has no second person to approve a change to what is collected or
 * who sees it, so a version that needs one can't publish (ADR-0010, open
 * question for the founder). The seeded version 1 forms ship by migration.
 */

export interface PublishProblem {
  code: string
  path: string
}

export interface PublishCandidate {
  slug: string
  kind: FormKind
  purpose: string
  /** Parsed JSON, not yet checked. */
  definition: unknown
  /** Parsed JSON: `{ "en-GB": { key: text } }`, not yet checked. */
  text: unknown
}

export interface PublishedVersion {
  purpose: string
  definition: FormDefinition
}

export interface PublishCheck {
  ok: boolean
  problems: PublishProblem[]
  /** A change to what is collected or who sees it (Ezra). */
  needsSecondApproval: boolean
}

/** Slugs are a URL part and the Turnstile action, so short and plain (ADR-0010). */
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/

/** Slugs that would clash with our own routes or mislead. */
export const reservedSlugs = [
  'admin',
  'api',
  'apply',
  'edit',
  'forms',
  'new',
  'roles',
  'safeguarding',
  'say-hello',
] as const

/** Locales a form may publish in. Welsh waits for a translation decision. */
export const publishLocales = ['en-GB'] as const

/** Most characters each kind of admin text may have. */
export const TEXT_LIMITS = {
  title: 120,
  intro: 1000,
  heading: 120,
  noteBody: 1000,
  label: 300,
  hint: 600,
  summary: 80,
  choice: 200,
  notes: 600,
  link: 120,
} as const

/** Labels must never ask for these, so nobody can use our name to collect them (Nadia). */
const CREDENTIALS =
  /\b(?:pass(?:word|code|phrase)s?|pins?|pin (?:number|code)s?|bank details|card (?:number|details)s?|sort codes?|account numbers?|security codes?|cvv|one[- ]time (?:code|password)s?|verification codes?|log-?in details)\b/i

/** Common US spellings, with the British one to use. */
const US_SPELLINGS: readonly { pattern: RegExp; use: string }[] = [
  { pattern: /\bcolor(?:s|ed|ful)?\b/i, use: 'colour' },
  { pattern: /\bfavor(?:s|ed|ite|ites)?\b/i, use: 'favour' },
  { pattern: /\bbehavior(?:s|al)?\b/i, use: 'behaviour' },
  { pattern: /\bhonor(?:s|ed)?\b/i, use: 'honour' },
  { pattern: /\bcenter(?:s|ed)?\b/i, use: 'centre' },
  { pattern: /\b(?:organiz|recogniz|apologiz|realiz|analyz|prioritiz)\w*/i, use: '-ise' },
  { pattern: /\b(?:traveled|traveling|canceled|canceling)\b/i, use: 'travelled, cancelled' },
  { pattern: /\bdefense\b/i, use: 'defence' },
]

/** Every text key a version needs, and those it may have, with each one's limit. */
export function textKeys(definition: FormDefinition): {
  required: Map<string, number>
  optional: Map<string, number>
} {
  const required = new Map<string, number>([['title', TEXT_LIMITS.title]])
  const optional = new Map<string, number>([['intro', TEXT_LIMITS.intro]])
  if (definition.note) {
    required.set('note.heading', TEXT_LIMITS.heading)
    required.set('note.body', TEXT_LIMITS.noteBody)
  }
  for (const step of definition.steps) optional.set(`steps.${step.id}.heading`, TEXT_LIMITS.heading)
  for (const { field } of fieldsOf(definition)) {
    const key = `fields.${field.id}`
    required.set(`${key}.label`, TEXT_LIMITS.label)
    required.set(`${key}.summary`, TEXT_LIMITS.summary)
    optional.set(`${key}.hint`, TEXT_LIMITS.hint)
    if (field.type === 'single_choice') {
      for (const choice of field.choices)
        required.set(`${key}.choices.${choice}`, TEXT_LIMITS.choice)
      for (const [choice, outcome] of Object.entries(field.outcomes ?? {})) {
        if ('note' in outcome) required.set(`${key}.notes.${choice}`, TEXT_LIMITS.notes)
      }
    }
    if (field.type === 'confirm') {
      required.set(`${key}.choices.yes`, TEXT_LIMITS.choice)
      if (field.link) required.set(`${key}.link`, TEXT_LIMITS.link)
    }
  }
  return { required, optional }
}

/** Copy problems in one piece of admin text, as codes. */
export function copyProblems(value: string): string[] {
  const codes: string[] = []
  if (bannedTerms.some(({ pattern }) => pattern.test(value))) codes.push('banned_term')
  if (US_SPELLINGS.some(({ pattern }) => pattern.test(value))) codes.push('us_spelling')
  if (CREDENTIALS.test(value)) codes.push('asks_for_credentials')
  return codes
}

function checkText(definition: FormDefinition, text: unknown, problems: PublishProblem[]) {
  const add = (code: string, path: string) => problems.push({ code, path })
  if (typeof text !== 'object' || text === null || Array.isArray(text)) {
    add('text_shape', 'text')
    return
  }
  if (JSON.stringify(text).length > LIMITS.textJson) add('text_too_large', 'text')
  for (const locale of Object.keys(text)) {
    if (!(publishLocales as readonly string[]).includes(locale))
      add('locale_not_allowed', `text.${locale}`)
  }
  const entries = (text as Record<string, unknown>)['en-GB']
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    add('locale_missing', 'text.en-GB')
    return
  }
  const { required, optional } = textKeys(definition)
  for (const key of required.keys()) {
    if (!Object.hasOwn(entries, key)) add('text_missing', `text.en-GB.${key}`)
  }
  for (const [key, value] of Object.entries(entries)) {
    const path = `text.en-GB.${key}`
    const limit = required.get(key) ?? optional.get(key)
    if (limit === undefined) {
      add('text_unknown_key', path)
      continue
    }
    if (typeof value !== 'string' || value.trim() === '') {
      add('text_empty', path)
      continue
    }
    if ([...value].length > limit) add('text_too_long', path)
    for (const code of copyProblems(value)) add(code, path)
  }
}

/** Whether a new version changes what is collected or who sees it (Ezra). */
export function needsSecondApproval(
  previous: PublishedVersion | null,
  next: PublishedVersion,
): boolean {
  if (previous === null) return true
  if (previous.purpose !== next.purpose) return true
  const readers = (definition: FormDefinition) => [...definition.readers].sort().join(',')
  if (readers(previous.definition) !== readers(next.definition)) return true
  return JSON.stringify(previous.definition.steps) !== JSON.stringify(next.definition.steps)
}

/**
 * The checks a definition must pass against its P3 purpose: field types,
 * readers, retention, the safeguarding hand-over for free text, the actions,
 * the receipt and the body cap. Publishing runs them, and so does every read
 * of a stored version, so a row changed outside publishing is never used.
 */
export function purposeProblems(
  definition: FormDefinition,
  purpose: Purpose,
  kind: FormKind,
): PublishProblem[] {
  const problems: PublishProblem[] = []
  const add = (code: string, path: string) => problems.push({ code, path })
  if (purpose.kind !== kind) add('purpose_kind', 'purpose')
  for (const { field } of fieldsOf(definition)) {
    if (!(purpose.fieldTypes as readonly string[]).includes(field.type))
      add('field_type_not_allowed', `definition.fields.${field.id}`)
  }
  for (const reader of definition.readers) {
    if (!(purpose.readers as readonly string[]).includes(reader))
      add('reader_not_allowed', 'definition.readers')
  }
  if ((definition.retentionMonths ?? 0) > purpose.retention.months)
    add('retention_too_long', 'definition.retentionMonths')
  if (purpose.freeText && !definition.actions.includes('pass_to_safeguarding'))
    add('safeguarding_action_missing', 'definition.actions')
  if (definition.actions.includes('reply') && purpose.retention.base !== 'replied')
    add('action_not_allowed', 'definition.actions')
  if (definition.actions.includes('outcome_told') && purpose.retention.base !== 'outcome_told')
    add('action_not_allowed', 'definition.actions')
  const hasFreeText = fieldsOf(definition).some(({ field }) => freeTextTypes.includes(field.type))
  if (hasFreeText && !purpose.freeText) add('free_text_not_allowed', 'definition')
  if (definition.receipt === 'application_receipt' && kind !== 'application')
    add('receipt_not_allowed', 'definition.receipt')
  if (bodyCapFor(definition, kind) > FORM_BODY_CAP_MAX) add('body_cap_too_large', 'definition')
  return problems
}

export function checkPublish(
  candidate: PublishCandidate,
  previous: PublishedVersion | null,
): PublishCheck {
  const problems: PublishProblem[] = []
  const add = (code: string, path: string) => problems.push({ code, path })

  if (!SLUG.test(candidate.slug)) add('slug_invalid', 'slug')
  if ((reservedSlugs as readonly string[]).includes(candidate.slug)) add('slug_reserved', 'slug')

  const purpose = findPurpose(candidate.purpose)
  if (!purpose) add('purpose_unknown', 'purpose')

  if (JSON.stringify(candidate.definition ?? null).length > LIMITS.definitionJson) {
    add('definition_too_large', 'definition')
    return { ok: false, problems, needsSecondApproval: true }
  }
  const parsed = definitionSchema.safeParse(candidate.definition)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      add(
        issue.code === 'custom' ? issue.message : `definition_${issue.code}`,
        ['definition', ...issue.path].join('.'),
      )
    }
    return { ok: false, problems, needsSecondApproval: true }
  }
  const definition = parsed.data

  if (purpose) problems.push(...purposeProblems(definition, purpose, candidate.kind))

  checkText(definition, candidate.text, problems)

  const second = needsSecondApproval(previous, { purpose: candidate.purpose, definition })
  // Phase 1: nobody can give a second approval yet, so such a version waits.
  if (second) add('second_approval_needed', 'definition')
  return { ok: problems.length === 0, problems, needsSecondApproval: second }
}
