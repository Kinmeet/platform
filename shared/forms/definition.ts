import { z } from 'zod'
import { p4Roles } from '../privacy/roles'
import { CALL_NAME_MAX, EMAIL_MAX } from './fields'

/**
 * What a stored form version holds (ADR-0010, section 1), and the limits on
 * it. Definitions are data in D1 (`form_versions`), but everything a
 * definition can say is bounded here, in reviewed code: the six field types,
 * the stop reasons, the admin actions, and the size of every part the
 * run-time schema is built from (Nadia). `definitionSchema` checks a
 * definition's shape and limits; `shared/forms/publish.ts` adds the checks
 * that need its purpose and text.
 */

/** The fixed field-type library. A new type is a reviewed PR with its own P3 row. */
export const fieldTypes = [
  'short_text',
  'long_text',
  'email',
  'call_name',
  'single_choice',
  'confirm',
] as const
export type FieldType = (typeof fieldTypes)[number]

/** Types whose answers are a person's own words (SG6). */
export const freeTextTypes: readonly FieldType[] = ['short_text', 'long_text']

/** Why an answer ends the form. Matches the API error codes; a new one needs a decision. */
export const stopReasons = ['under_18', 'not_independent'] as const
export type StopReason = (typeof stopReasons)[number]

/** Admin actions a form can offer. */
export const adminActions = ['reply', 'outcome_told', 'pass_to_safeguarding'] as const
export type AdminAction = (typeof adminActions)[number]

/** Receipt emails a form can send: an ADR-0006 template, or none. */
export const receipts = ['none', 'application_receipt'] as const

/** Where a step's answers sit in the request body: top level, or under a key. */
export const bodyKeys = ['checks', 'answers'] as const
export type BodyKey = (typeof bodyKeys)[number]

export const LIMITS = {
  steps: 4,
  fieldsPerStep: 10,
  choicesMin: 2,
  choicesMax: 10,
  idLength: 40,
  /** Hard maxima per text type; a field may set a lower `maxLength`. */
  maxLength: { short_text: 200, long_text: 2000 },
  /** Characters of the stored definition JSON. */
  definitionJson: 32 * 1024,
  /** Characters of the stored text JSON, every locale together. */
  textJson: 64 * 1024,
} as const

/**
 * The largest body cap a published version may have. A fixed constant, so
 * the Worker's entry limit for form routes (ADR-0008) never depends on what
 * an admin publishes; publishing refuses any version over it.
 */
export const FORM_BODY_CAP_MAX = 64 * 1024

/** Field and choice ids: lower case, digits and underscores, starting with a letter. */
const ID = /^[a-z][a-z0-9_]*$/

/** Request keys every form already uses, which a top-level field can't take. */
export const reservedFieldIds = [
  'submission_id',
  'call_name',
  'email',
  'turnstile_token',
  'role',
  ...bodyKeys,
] as const

// An id is used as an object key, so it can't be a name every object already
// has, such as `constructor`: a missing answer would find Object.prototype's.
const plainId = z
  .string()
  .min(1)
  .max(LIMITS.idLength)
  .regex(ID)
  .refine((value) => !Object.hasOwn(Object.prototype, value), 'reserved_id')

const id = plainId.refine(
  (value) => !(reservedFieldIds as readonly string[]).includes(value),
  'reserved_id',
)

/** Only one outside site may be linked from a confirm field, and only over HTTPS. */
export const LINK_ORIGINS = ['https://www.gov.uk'] as const

const link = z
  .url()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value)
      return (LINK_ORIGINS as readonly string[]).includes(url.origin) && !url.username
    } catch {
      return false
    }
  }, 'link_not_allowed')

const showIf = z.strictObject({
  field: id,
  in: z.array(plainId).min(1).max(LIMITS.choicesMax),
})

const base = { id, showIf: showIf.optional() }

const shortText = z.strictObject({
  ...base,
  type: z.literal('short_text'),
  required: z.boolean(),
  maxLength: z.int().min(1).max(LIMITS.maxLength.short_text),
})

const longText = z.strictObject({
  ...base,
  type: z.literal('long_text'),
  required: z.boolean(),
  maxLength: z.int().min(1).max(LIMITS.maxLength.long_text),
})

const emailField = z.strictObject({ ...base, type: z.literal('email'), required: z.boolean() })

const callNameField = z.strictObject({
  ...base,
  type: z.literal('call_name'),
  required: z.boolean(),
})

const outcome = z.union([
  z.strictObject({ stop: z.enum(stopReasons) }),
  z.strictObject({ note: z.literal(true) }),
])

const singleChoice = z.strictObject({
  ...base,
  type: z.literal('single_choice'),
  required: z.boolean(),
  choices: z.array(plainId).min(LIMITS.choicesMin).max(LIMITS.choicesMax),
  outcomes: z.record(plainId, outcome).optional(),
})

/** A statement to tick. Its only answer is `yes`, so it is always required. */
const confirm = z.strictObject({
  ...base,
  type: z.literal('confirm'),
  required: z.literal(true),
  link: link.optional(),
})

export const fieldSchema = z.discriminatedUnion('type', [
  shortText,
  longText,
  emailField,
  callNameField,
  singleChoice,
  confirm,
])

export type FieldDefinition = z.infer<typeof fieldSchema>

const step = z.strictObject({
  id: plainId,
  /** `null` puts the step's answers at the top level of the body, as say hello does. */
  body: z.enum(bodyKeys).nullable(),
  fields: z.array(fieldSchema).min(1).max(LIMITS.fieldsPerStep),
})

export type StepDefinition = z.infer<typeof step>

/** Problems found with a definition, by code, so admins see fixed text only. */
export type DefinitionProblem = { code: string; path: string }

export const definitionSchema = z
  .strictObject({
    steps: z.array(step).min(1).max(LIMITS.steps),
    /** "About you" (call name and email) comes before the step at this index. */
    aboutYou: z.int().min(0).max(LIMITS.steps),
    /** Whether the form shows a note at the foot of its first step, `note.heading` and `note.body`. */
    note: z.boolean(),
    receipt: z.enum(receipts),
    actions: z.array(z.enum(adminActions)).max(adminActions.length),
    readers: z.array(z.enum(p4Roles)).min(1).max(p4Roles.length),
    /** A shorter retention period than the purpose's, in months. */
    retentionMonths: z.int().min(1).optional(),
  })
  .superRefine((definition, ctx) => {
    const problem = (code: string, path: PropertyKey[]) =>
      ctx.addIssue({ code: 'custom', message: code, path })

    if (definition.aboutYou > definition.steps.length) problem('about_you_position', ['aboutYou'])
    if (new Set(definition.actions).size !== definition.actions.length)
      problem('duplicate_action', ['actions'])
    if (new Set(definition.readers).size !== definition.readers.length)
      problem('duplicate_reader', ['readers'])

    const stepIds = new Set<string>()
    const bodies = new Set<string | null>()
    // Every field id is unique across the form, because answers are stored flat.
    const seen = new Map<string, FieldDefinition>()
    definition.steps.forEach((current, s) => {
      if (stepIds.has(current.id)) problem('duplicate_step', ['steps', s, 'id'])
      stepIds.add(current.id)
      if (bodies.has(current.body)) problem('duplicate_body', ['steps', s, 'body'])
      bodies.add(current.body)

      current.fields.forEach((field, f) => {
        const path = ['steps', s, 'fields', f]
        if (seen.has(field.id)) problem('duplicate_field', [...path, 'id'])

        if (field.type === 'single_choice') {
          if (new Set(field.choices).size !== field.choices.length)
            problem('duplicate_choice', [...path, 'choices'])
          for (const choice of Object.keys(field.outcomes ?? {})) {
            if (!field.choices.includes(choice)) problem('unknown_choice', [...path, 'outcomes'])
          }
          // At least one answer must let the person carry on.
          const stops = Object.values(field.outcomes ?? {}).filter((o) => 'stop' in o).length
          if (stops >= field.choices.length) problem('every_choice_stops', [...path, 'outcomes'])
        }

        // A condition can only look back, at a choice field, at its own choices.
        if (field.showIf) {
          const target = seen.get(field.showIf.field)
          if (target?.type !== 'single_choice') {
            problem('show_if_target', [...path, 'showIf'])
          } else if (field.showIf.in.some((choice) => !target.choices.includes(choice))) {
            problem('show_if_choice', [...path, 'showIf'])
          }
        }
        seen.set(field.id, field)
      })
    })
  })

export type FormDefinition = z.infer<typeof definitionSchema>

/** Every field, in order, with the body key of its step. */
export function fieldsOf(
  definition: FormDefinition,
): { field: FieldDefinition; body: BodyKey | null }[] {
  return definition.steps.flatMap((current) =>
    current.fields.map((field) => ({ field, body: current.body })),
  )
}

/** Most code points an answer to a field may have, for the body cap. */
export function answerMaximum(field: FieldDefinition): number {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return field.maxLength
    case 'email':
      return EMAIL_MAX
    case 'call_name':
      return CALL_NAME_MAX
    case 'single_choice':
      // The id travels as a key and the choice as its value.
      return [...field.id].length + Math.max(...field.choices.map((choice) => [...choice].length))
    case 'confirm':
      return [...field.id].length + 'yes'.length
  }
}
