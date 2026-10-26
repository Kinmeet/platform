import type { z } from 'zod'

/**
 * The stable error codes the API returns. Pages turn each code into
 * translated text; no user-facing words come from the API.
 */
export const fieldErrorCodes = [
  'required',
  'too_long',
  'invalid_email',
  'invalid_choice',
  'unknown_field',
  'under_18',
  'not_independent',
  'turnstile_failed',
  'unknown_role',
  'role_closed',
] as const

export type FieldErrorCode = (typeof fieldErrorCodes)[number]

export interface FieldError {
  /** The request's field name, dotted for nested ones (`answers.why_trustee`). */
  field: string
  code: FieldErrorCode
}

export type FieldErrorsResult = { ok: true; errors: FieldError[] } | { ok: false }

function isFieldErrorCode(value: unknown): value is FieldErrorCode {
  return typeof value === 'string' && (fieldErrorCodes as readonly string[]).includes(value)
}

function fieldName(path: readonly PropertyKey[]): string {
  return path.map(String).join('.')
}

/** The value at a path in the submitted body, or `undefined` if missing. */
function valueAt(input: unknown, path: readonly PropertyKey[]): unknown {
  let value = input
  for (const key of path) {
    if (typeof value !== 'object' || value === null) return undefined
    value = (value as Record<PropertyKey, unknown>)[key]
  }
  return value
}

/** Maps one Zod issue to our codes, or `null` when it is not a field problem. */
function codeFor(issue: z.core.$ZodIssue, input: unknown): FieldErrorCode | null {
  switch (issue.code) {
    case 'custom':
      return isFieldErrorCode(issue.params?.code) ? issue.params.code : null
    case 'too_small':
      return 'required'
    case 'too_big':
      return 'too_long'
    case 'invalid_format':
      return issue.format === 'email' ? 'invalid_email' : null
    case 'invalid_value':
      return 'invalid_choice'
    case 'invalid_type':
      // A missing field is something a person can fix; any other wrong type
      // never comes from our own page.
      return valueAt(input, issue.path) === undefined ? 'required' : null
    default:
      return null
  }
}

/** At most this many field errors are returned, so a body full of made-up keys can't fill the response. */
export const MAX_FIELD_ERRORS = 10

/**
 * Turns Zod issues for `input` into `{ field, code }` pairs, one per field (the first
 * issue wins), with an `unknown_field` for each unexpected key, up to
 * `MAX_FIELD_ERRORS`.
 *
 * Returns `{ ok: false }` when an issue is not something a person filling in
 * our form could cause (a wrong type, a malformed id), so the route answers
 * `400 bad_request` instead of pointing at a field.
 */
export function toFieldErrors(
  issues: readonly z.core.$ZodIssue[],
  input: unknown,
): FieldErrorsResult {
  const errors: FieldError[] = []
  const seen = new Set<string>()
  const add = (field: string, code: FieldErrorCode) => {
    if (seen.has(field) || errors.length >= MAX_FIELD_ERRORS) return
    seen.add(field)
    errors.push({ field, code })
  }

  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) add(fieldName([...issue.path, key]), 'unknown_field')
      continue
    }
    const code = codeFor(issue, input)
    if (code === null) return { ok: false }
    add(fieldName(issue.path), code)
  }
  return { ok: true, errors }
}
