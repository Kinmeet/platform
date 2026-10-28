import { z } from 'zod'
import {
  CALL_NAME_MAX,
  EMAIL_MAX,
  SUBMISSION_ID_LENGTH,
  TURNSTILE_TOKEN_MAX,
  bodyCapBytes,
  callName,
  codePointLength,
  email,
  submissionId,
  text,
  turnstileToken,
} from './fields'
import {
  answerMaximum,
  fieldsOf,
  type BodyKey,
  type FieldDefinition,
  type FormShape,
} from './definition'

/**
 * The run-time schema for a stored form version (ADR-0010): the request a
 * page sends, built from the version's definition with the same primitives
 * and error codes as the hand-written schemas before it (ADR-0005). Ids not
 * in the version are `unknown_field`, and an answer to a field its show-if
 * condition hides is refused, never stored (Nadia, Ezra).
 *
 * The request keeps the forms contract (docs/api/forms.md): `submissionId`,
 * then, for an application, `role`, then each step's answers in order, with
 * `callName` and `email` where "About you" sits, then `turnstileToken`.
 */

/** Longest role slug an application's body cap allows for. */
export const ROLE_SLUG_MAX = 64

export type FormKind = 'form' | 'application'

/** An answer that may be missing or left empty; an empty one is dropped. */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .refine((value) => codePointLength(value) <= max, { params: { code: 'too_long' } })
    .optional()
}

/** Empty or blank counts as not answered, then the usual checks. */
function blankAsMissing<T extends z.ZodType>(schema: T) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema.optional(),
  )
}

function answerSchema(field: FieldDefinition): z.ZodType {
  switch (field.type) {
    case 'short_text':
    case 'long_text':
      return field.required ? text(field.maxLength) : optionalText(field.maxLength)
    case 'email':
      return field.required ? email : blankAsMissing(email)
    case 'call_name':
      return field.required ? callName : blankAsMissing(callName)
    case 'confirm':
      // A statement to tick: anything but `yes` is not ticked.
      return z
        .string()
        .refine((value) => value === 'yes', { params: { code: 'required' }, abort: true })
    case 'single_choice': {
      const outcomes = field.outcomes ?? {}
      const choice = z.enum(field.choices as [string, ...string[]]).superRefine((value, ctx) => {
        const outcome = outcomes[value]
        if (outcome && 'stop' in outcome) {
          // The page ends the flow here; this is the server's backstop.
          ctx.addIssue({ code: 'custom', params: { code: outcome.stop }, input: value })
        }
      })
      return field.required ? choice : choice.optional()
    }
  }
}

/** A field with a show-if condition is optional in the object; the body check decides. */
function schemaInObject(field: FieldDefinition): z.ZodType {
  const schema = answerSchema(field)
  return field.showIf ? schema.optional() : schema
}

function answerAt(body: Record<string, unknown>, key: BodyKey | null, fieldId: string): unknown {
  const holder = key === null ? body : (body[key] as Record<string, unknown> | undefined)
  // Own keys only, so an id such as `constructor` never finds Object.prototype.
  if (holder === null || typeof holder !== 'object' || !Object.hasOwn(holder, fieldId))
    return undefined
  return holder[fieldId]
}

/**
 * The request schema for one version. For an application, `role` must be
 * the form's slug; `applicationSchema` checks unknown and closed roles first.
 */
export function submissionSchema(
  definition: FormShape,
  { kind, slug }: { kind: FormKind; slug: string },
) {
  const shape: Record<string, z.ZodType> = { submissionId }
  if (kind === 'application') shape.role = z.literal(slug)
  definition.steps.forEach((step, index) => {
    if (index === definition.aboutYou) Object.assign(shape, { callName, email })
    const fields = Object.fromEntries(step.fields.map((field) => [field.id, schemaInObject(field)]))
    if (step.body === null) Object.assign(shape, fields)
    else shape[step.body] = z.strictObject(fields)
  })
  if (definition.aboutYou === definition.steps.length) Object.assign(shape, { callName, email })
  shape.turnstileToken = turnstileToken

  const conditional = fieldsOf(definition).filter(({ field }) => field.showIf)
  const located = new Map(fieldsOf(definition).map(({ field, body }) => [field.id, body]))
  return z.strictObject(shape).superRefine((body, ctx) => {
    for (const { field, body: key } of conditional) {
      const condition = field.showIf!
      const shown = condition.in.includes(
        answerAt(body, located.get(condition.field) ?? null, condition.field) as string,
      )
      const answer = answerAt(body, key, field.id)
      const path = key === null ? [field.id] : [key, field.id]
      if (!shown && answer !== undefined) {
        ctx.addIssue({ code: 'custom', params: { code: 'unknown_field' }, path, input: answer })
      } else if (shown && field.required && answer === undefined) {
        ctx.addIssue({ code: 'custom', params: { code: 'required' }, path, input: answer })
      }
    }
  })
}

export type StoredSubmission = { submissionId: string; callName: string; email: string } & Record<
  string,
  unknown
>

/** A form as the application route sees it: open ones carry their current version. */
export interface ApplicationForm {
  slug: string
  status: 'draft' | 'open' | 'closed'
  definition: FormShape | null
}

/**
 * `POST /api/apply`: the `role` is checked first, against every application
 * form. An unknown slug is `unknown_role` and a form that isn't open is
 * `role_closed`. Only then is the rest checked against that form's version.
 */
export function applicationSchema(forms: readonly ApplicationForm[]) {
  const bySlug = new Map(forms.map((form) => [form.slug, form]))
  const role = z.string().superRefine((slug, ctx) => {
    const form = bySlug.get(slug)
    if (form === undefined) {
      ctx.addIssue({ code: 'custom', params: { code: 'unknown_role' }, input: slug })
    } else if (form.status !== 'open' || form.definition === null) {
      ctx.addIssue({ code: 'custom', params: { code: 'role_closed' }, input: slug })
    }
  })
  const open = forms.flatMap((form) =>
    form.status === 'open' && form.definition
      ? [submissionSchema(form.definition, { kind: 'application', slug: form.slug })]
      : [],
  )
  // With no open form every role fails its check above, so this is never reached.
  const [first, ...rest] = open
  const byRole: z.ZodType = first ? z.discriminatedUnion('role', [first, ...rest]) : z.never()
  return z.looseObject({ role }).pipe(byRole as z.ZodType<unknown, { role: string }>)
}

/** The largest body a valid request for this version can have. */
export function bodyCapFor(definition: Pick<FormShape, 'steps'>, kind: FormKind): number {
  return bodyCapBytes([
    SUBMISSION_ID_LENGTH,
    ...(kind === 'application' ? [ROLE_SLUG_MAX] : []),
    ...fieldsOf(definition).map(({ field }) => answerMaximum(field)),
    CALL_NAME_MAX,
    EMAIL_MAX,
    TURNSTILE_TOKEN_MAX,
  ])
}

/**
 * Whether a field's answer tells us anything. A tick, or a choice with only
 * one answer that lets the person carry on, can only ever be that answer
 * once accepted, so it is not stored (P3: collect the minimum).
 */
export function isStored(field: FieldDefinition): boolean {
  if (field.type === 'confirm') return false
  if (field.type !== 'single_choice') return true
  const stops = new Set(
    Object.entries(field.outcomes ?? {})
      .filter(([, outcome]) => 'stop' in outcome)
      .map(([choice]) => choice),
  )
  return field.choices.filter((choice) => !stops.has(choice)).length > 1
}

/**
 * The answers to keep, flat by field id in the version's order: trimmed,
 * with empty optional answers and unstored fields left out.
 */
export function storedAnswers(
  definition: Pick<FormShape, 'steps'>,
  submission: Record<string, unknown>,
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const { field, body } of fieldsOf(definition)) {
    if (!isStored(field)) continue
    const value = answerAt(submission, body, field.id)
    if (typeof value === 'string' && value !== '') answers[field.id] = value
  }
  return answers
}
