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
import { bodyLimitFor, submitPathFor } from '../routes'
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
  /** Parsed JSON: `{ "en-GB": { key: text } }`. */
  text: unknown
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
  /\b(?:pass(?:word|code|phrase)s?|pins?|pin (?:number|code)s?|bank (?:details|accounts?)|(?:credit|debit) cards?|card (?:number|details)s?|sort codes?|account numbers?|iban|security (?:codes?|questions?)|cvv|one[- ]time (?:code|password)s?|verification codes?|(?:log|sign)[- ]?in details)\b/i

/**
 * Text as the copy checks read it: compatibility forms folded (NFKC, so
 * full-width or styled letters match) and invisible format characters
 * removed (`\p{Cf}`, such as zero-width spaces), so neither can slip a
 * banned word past them (Nadia, #158). The stored text is left as written.
 */
export function normaliseForChecks(value: string): string {
  return value.normalize('NFKC').replace(/\p{Cf}/gu, '')
}

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
export function textKeys(definition: Pick<FormDefinition, 'steps' | 'note'>): {
  required: Map<string, number>
  optional: Map<string, number>
} {
  const required = new Map<string, number>([['title', TEXT_LIMITS.title]])
  const optional = new Map<string, number>([['intro', TEXT_LIMITS.intro]])
  if (definition.note) {
    required.set('note.heading', TEXT_LIMITS.heading)
    required.set('note.body', TEXT_LIMITS.noteBody)
  }
  // Every step page needs one heading (Robin, #74). A checks or answers step
  // has a fixed one, and a one-step form uses its title, so only a top-level
  // step in a form with more than one needs its own.
  for (const step of definition.steps) {
    const key = `steps.${step.id}.heading`
    if (step.body === null && definition.steps.length > 1) required.set(key, TEXT_LIMITS.heading)
    else optional.set(key, TEXT_LIMITS.heading)
  }
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
export function copyProblems(written: string): string[] {
  const value = normaliseForChecks(written)
  const codes: string[] = []
  if (bannedTerms.some(({ pattern }) => pattern.test(value))) codes.push('banned_term')
  if (US_SPELLINGS.some(({ pattern }) => pattern.test(value))) codes.push('us_spelling')
  if (CREDENTIALS.test(value)) codes.push('asks_for_credentials')
  return codes
}

/**
 * The text's shape: one allowed locale, every key the version needs, no
 * others, each a non-empty string within its limit. Checked on publish and
 * again on every read, like the purpose checks. The copy rules below are
 * checked on publish only, so a rule added later never takes down a form
 * that was published before it.
 */
export function textShapeProblems(
  definition: Pick<FormDefinition, 'steps' | 'note'>,
  text: unknown,
): PublishProblem[] {
  const problems: PublishProblem[] = []
  const add = (code: string, path: string) => problems.push({ code, path })
  if (typeof text !== 'object' || text === null || Array.isArray(text)) {
    add('text_shape', 'text')
    return problems
  }
  if (JSON.stringify(text).length > LIMITS.textJson) add('text_too_large', 'text')
  for (const locale of Object.keys(text)) {
    if (!(publishLocales as readonly string[]).includes(locale))
      add('locale_not_allowed', `text.${locale}`)
  }
  const entries = (text as Record<string, unknown>)['en-GB']
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    add('locale_missing', 'text.en-GB')
    return problems
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
  }
  return problems
}

/** Link text that says nothing about where it goes (WCAG 2.4.4). */
const VAGUE_LINK =
  /^(?:here|click here|read more|more|link|this link|find out more)$|^(?:https?:\/\/|www\.)/i

/** The same words, ignoring letter case, spacing and closing punctuation. */
function sameWords(a: string, b: string): boolean {
  const plain = (value: string) =>
    normaliseForChecks(value)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[.?!:]+$/, '')
  return plain(a) === plain(b)
}

/**
 * The copy rules, checked on publish (ADR-0010): banned terms, US spellings
 * and credential requests in every piece of text, then the accessibility
 * checks that stop the commonest barriers an admin can make (Robin, #158).
 * Each field's summary names its question on its own, in the error list and
 * on Check and send, so it needs at least two words and must differ from
 * every other summary in the form.
 */
function copyRules(
  definition: Pick<FormDefinition, 'steps'>,
  entries: Record<string, unknown>,
  problems: PublishProblem[],
) {
  const add = (code: string, path: string) => problems.push({ code, path })
  const text = (key: string) => {
    const value = entries[key]
    return typeof value === 'string' ? value : undefined
  }
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') continue
    for (const code of copyProblems(value)) add(code, `text.en-GB.${key}`)
  }
  const summaries: { value: string; key: string }[] = []
  for (const current of definition.steps) {
    const labels: { value: string; key: string }[] = []
    for (const field of current.fields) {
      const key = `fields.${field.id}`
      const label = text(`${key}.label`)
      const hint = text(`${key}.hint`)
      const summary = text(`${key}.summary`)
      if (label !== undefined) {
        if (labels.some((other) => sameWords(other.value, label)))
          add('duplicate_label', `text.en-GB.${key}.label`)
        labels.push({ value: label, key })
        if (hint !== undefined && sameWords(hint, label))
          add('hint_repeats_label', `text.en-GB.${key}.hint`)
      }
      if (summary !== undefined) {
        if (normaliseForChecks(summary).trim().split(/\s+/).length < 2)
          add('summary_too_short', `text.en-GB.${key}.summary`)
        if (summaries.some((other) => sameWords(other.value, summary)))
          add('duplicate_summary', `text.en-GB.${key}.summary`)
        summaries.push({ value: summary, key })
      }
      if (field.type === 'single_choice') {
        const seen: string[] = []
        for (const choice of field.choices) {
          const words = text(`${key}.choices.${choice}`)
          if (words === undefined) continue
          if (seen.some((other) => sameWords(other, words)))
            add('duplicate_choice_text', `text.en-GB.${key}.choices.${choice}`)
          seen.push(words)
        }
      }
      if (field.type === 'confirm' && field.link) {
        const words = text(`${key}.link`)
        if (words !== undefined && VAGUE_LINK.test(normaliseForChecks(words).trim()))
          add('vague_link_text', `text.en-GB.${key}.link`)
      }
    }
  }
}

/**
 * Every text check publishing runs: the shape, then the copy rules. Also run
 * by a migration test over every stored version, so wording that arrives by
 * a reviewed migration gets the same checks as the admin screen (Nadia, #159).
 */
export function textProblems(
  definition: Pick<FormDefinition, 'steps' | 'note'>,
  text: unknown,
): PublishProblem[] {
  const problems = textShapeProblems(definition, text)
  const entries = (text as Record<string, Record<string, unknown>> | null)?.['en-GB']
  if (typeof entries === 'object' && entries !== null && !Array.isArray(entries))
    copyRules(definition, entries, problems)
  return problems
}

/**
 * Text that tells someone what to put in an answer: a field's label, hint,
 * summary and choices. Rewording any of these can change what is really
 * being asked, so it needs a second approval like a new field does (Ezra,
 * #160). The title, intro, step headings, notes and link text stay
 * wording-only.
 */
const ASKING_TEXT = /^fields\.[^.]+\.(?:label|hint|summary|choices\.[^.]+)$/

/**
 * Words that suggest special-category, criminal-record or credential data.
 * Any of them in any text, in any locale, wording-only changes included,
 * means a person must look before the version publishes (Ezra, #160 and
 * #163). A false positive only costs a second look; a miss costs a quiet
 * new kind of data.
 */
const SENSITIVE_TERMS = new RegExp(
  `\\b(?:${[
    // Health, disability and sex life (UK GDPR Article 9)
    'health',
    'medical',
    'medic(?:ine|ines|ation)',
    'diagnos(?:is|es|ed)',
    'disab(?:ility|ilities|led)',
    'mental',
    'pregnan\\w*',
    'genetic',
    'biometric',
    'sexuality',
    'sexual orientation',
    'sex life',
    'gender',
    'trans',
    // Race, beliefs and membership (Article 9)
    'race',
    'racial',
    'ethnicity',
    'ethnic',
    'religion',
    'religious',
    'faith',
    'beliefs?',
    'political',
    'trade unions?',
    // Criminal-record data (Article 10)
    'convictions?',
    'convicted',
    'criminal',
    'offences?',
    'cautions?',
    'arrest\\w*',
    'police',
    'dbs',
    // Identifying details and credentials we never collect
    'date of birth',
    'home address',
    'postcode',
    'passwords?',
    'pin',
    'bank',
    'sort code',
    'card number',
  ]
    // Words split by more than one space, or a line break, still match.
    .map((term) => term.replaceAll(' ', '\\s+'))
    .join('|')})\\b`,
  'i',
)

/** Every locale's entries, so a translation can't carry what en-GB doesn't. */
function localeText(text: unknown): Map<string, unknown> {
  const all = new Map<string, unknown>()
  if (typeof text !== 'object' || text === null || Array.isArray(text)) return all
  for (const [locale, entries] of Object.entries(text)) {
    if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) continue
    for (const [key, value] of Object.entries(entries)) all.set(`${locale}\u0000${key}`, value)
  }
  return all
}

/** Whether a version has a sensitive term anywhere in its text. */
export function hasSensitiveTerm(text: unknown): boolean {
  return [...localeText(text).values()].some(
    (value) => typeof value === 'string' && SENSITIVE_TERMS.test(normaliseForChecks(value)),
  )
}

/**
 * Whether a new version needs a second approval (ADR-0010, Ezra): a new
 * form, a change to its purpose, readers or fields, a change to any text
 * that tells someone what to answer, or a sensitive term in any of its text.
 */
export function needsSecondApproval(
  previous: PublishedVersion | null,
  next: PublishedVersion,
): boolean {
  if (previous === null) return true
  if (previous.purpose !== next.purpose) return true
  const readers = (definition: FormDefinition) => [...definition.readers].sort().join(',')
  if (readers(previous.definition) !== readers(next.definition)) return true
  if (JSON.stringify(previous.definition.steps) !== JSON.stringify(next.definition.steps))
    return true
  const before = localeText(previous.text)
  const after = localeText(next.text)
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const textKey = key.slice(key.indexOf('\u0000') + 1)
    if (ASKING_TEXT.test(textKey) && before.get(key) !== after.get(key)) return true
  }
  return hasSensitiveTerm(next.text)
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
  // The Worker entry refuses a bigger body before the route sees it (ADR-0008).
  const routeLimit = bodyLimitFor('POST', submitPathFor(candidate.slug, candidate.kind))
  if (bodyCapFor(definition, candidate.kind) > routeLimit)
    add('body_cap_over_route_limit', 'definition')

  problems.push(...textProblems(definition, candidate.text))

  const second = needsSecondApproval(previous, {
    purpose: candidate.purpose,
    definition,
    text: candidate.text,
  })
  // Phase 1: nobody can give a second approval yet, so such a version waits.
  if (second) add('second_approval_needed', 'definition')
  return { ok: problems.length === 0, problems, needsSecondApproval: second }
}
