import { z } from 'zod'
import {
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
import { findRole, publishedRoles } from './roles'
import type { CheckQuestion, PublishedRole, RoleQuestion } from './roles'

/**
 * Apply: `POST /api/apply` (docs/api/forms.md, section 2).
 *
 * The schema is built from the role config (`shared/forms/roles`), so the
 * question ids, choices and required flags have one source. The `role` is
 * checked first: an unknown slug is `unknown_role` and a role that is not
 * open is `role_closed`. Only then is the rest checked against that role's
 * own questions, with unknown ids refused as `unknown_field`.
 */

const CALL_NAME_MAX = 60
/** Longest role slug the body cap allows for. */
const ROLE_SLUG_MAX = 64

const role = z.string().superRefine((slug, ctx) => {
  const config = findRole(slug)
  if (config === undefined) {
    ctx.addIssue({ code: 'custom', params: { code: 'unknown_role' }, input: slug })
  } else if (!config.published) {
    ctx.addIssue({ code: 'custom', params: { code: 'role_closed' }, input: slug })
  }
})

function checkSchema(question: CheckQuestion) {
  if (question.type === 'confirm') {
    // A statement the applicant must tick: anything but `yes` is not ticked.
    return z
      .string()
      .refine((value) => value === 'yes', { params: { code: 'required' }, abort: true })
  }
  const outcomes = question.outcomes ?? {}
  return z.enum(question.choices as [string, ...string[]]).superRefine((choice, ctx) => {
    const outcome = outcomes[choice]
    if (outcome && 'stop' in outcome) {
      // The page ends the flow here; this is the server's backstop.
      ctx.addIssue({ code: 'custom', params: { code: outcome.stop }, input: choice })
    }
  })
}

function answerSchema(question: RoleQuestion) {
  if (question.required) return text(question.maxLength)
  // An optional answer may be missing or left empty; an empty one is dropped.
  return z
    .string()
    .trim()
    .refine((value) => codePointLength(value) <= question.maxLength, {
      params: { code: 'too_long' },
    })
    .optional()
}

function roleSchema(config: PublishedRole) {
  return z.strictObject({
    submissionId,
    role: z.literal(config.slug),
    checks: z.strictObject(
      Object.fromEntries(config.apply.checks.map((check) => [check.id, checkSchema(check)])),
    ),
    callName,
    email,
    answers: z.strictObject(
      Object.fromEntries(
        config.apply.questions.map((question) => [question.id, answerSchema(question)]),
      ),
    ),
    turnstileToken,
  })
}

const [firstRole, ...otherRoles] = publishedRoles().map(roleSchema)
if (!firstRole) throw new Error('no_published_roles')

export const applySchema = z
  .looseObject({ role })
  .pipe(z.discriminatedUnion('role', [firstRole, ...otherRoles]))

export type ApplySubmission = z.infer<typeof applySchema>

/** Step 3 answers worth keeping: trimmed, with empty optional ones left out. */
export function storedAnswers(submission: ApplySubmission): Record<string, string> {
  return Object.fromEntries(
    Object.entries(submission.answers as Record<string, string | undefined>).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '',
    ),
  )
}

function longest(values: readonly string[]): number {
  return Math.max(0, ...values.map(codePointLength))
}

/** The largest body a valid apply request can have, for any open role. */
export const APPLY_BODY_CAP = Math.max(
  ...publishedRoles().map((config) =>
    bodyCapBytes([
      SUBMISSION_ID_LENGTH,
      ROLE_SLUG_MAX,
      ...config.apply.checks.map((check) => codePointLength(check.id) + longest(check.choices)),
      CALL_NAME_MAX,
      EMAIL_MAX,
      ...config.apply.questions.map((question) => question.maxLength),
      TURNSTILE_TOKEN_MAX,
    ]),
  ),
)
