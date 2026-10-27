import { describe, expect, it } from 'vitest'
import { APPLY_BODY_CAP, applySchema, storedAnswers } from '../../../../shared/forms/apply'
import { toFieldErrors } from '../../../../shared/forms/errors'
import { publishedRoles } from '../../../../shared/forms/roles'

// Made-up test data only.
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  role: 'trustee',
  checks: { over_18: 'yes', connection_to_founders: 'not_sure', trustee_rules_confirmed: 'yes' },
  callName: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: { why_trustee: 'A made-up reason.', experience: 'Made-up experience.' },
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

function errorsFor(input: unknown) {
  const result = applySchema.safeParse(input)
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, input)
  return mapped.ok ? mapped.errors : 'bad_request'
}

describe('apply schema', () => {
  it('accepts a valid trustee application and trims text', () => {
    const parsed = applySchema.parse({
      ...valid,
      callName: '  Sample Applicant ',
      answers: { why_trustee: '\nA made-up reason.\n' },
    })
    expect(parsed.callName).toBe('Sample Applicant')
    expect(parsed.answers).toEqual({ why_trustee: 'A made-up reason.' })
  })

  it('accepts every allowed founder-connection answer', () => {
    for (const answer of ['no', 'friend_or_acquaintance', 'not_sure']) {
      expect(
        errorsFor({ ...valid, checks: { ...valid.checks, connection_to_founders: answer } }),
      ).toEqual([])
    }
  })

  it('refuses unknown and closed roles before anything else', () => {
    expect(errorsFor({ ...valid, role: 'made-up-role', checks: {} })).toEqual([
      { field: 'role', code: 'unknown_role' },
    ])
    expect(errorsFor({ ...valid, role: 'treasurer' })).toEqual([
      { field: 'role', code: 'role_closed' },
    ])
    expect(errorsFor({ ...valid, role: undefined })).toEqual([{ field: 'role', code: 'required' }])
  })

  it('refuses under-18s and applicants who are not independent (backstops)', () => {
    expect(errorsFor({ ...valid, checks: { ...valid.checks, over_18: 'no' } })).toEqual([
      { field: 'checks.over_18', code: 'under_18' },
    ])
    expect(
      errorsFor({
        ...valid,
        checks: { ...valid.checks, connection_to_founders: 'related_or_household' },
      }),
    ).toEqual([{ field: 'checks.connection_to_founders', code: 'not_independent' }])
  })

  it('requires the trustee rules to be confirmed', () => {
    for (const value of ['no', '', undefined]) {
      expect(
        errorsFor({ ...valid, checks: { ...valid.checks, trustee_rules_confirmed: value } }),
      ).toEqual([{ field: 'checks.trustee_rules_confirmed', code: 'required' }])
    }
  })

  it('refuses a choice that is not in the config', () => {
    expect(errorsFor({ ...valid, checks: { ...valid.checks, over_18: 'maybe' } })).toEqual([
      { field: 'checks.over_18', code: 'invalid_choice' },
    ])
  })

  it('refuses unknown check and answer ids by name', () => {
    expect(
      errorsFor({
        ...valid,
        checks: { ...valid.checks, made_up_check: 'yes' },
        answers: { ...valid.answers, evening_a_month: 'yes' },
      }),
    ).toEqual([
      { field: 'checks.made_up_check', code: 'unknown_field' },
      { field: 'answers.evening_a_month', code: 'unknown_field' },
    ])
    expect(errorsFor({ ...valid, pronouns: 'they/them' })).toEqual([
      { field: 'pronouns', code: 'unknown_field' },
    ])
  })

  it('requires the required answer and limits every answer to 2000 code points', () => {
    expect(errorsFor({ ...valid, answers: { experience: 'x' } })).toEqual([
      { field: 'answers.why_trustee', code: 'required' },
    ])
    expect(errorsFor({ ...valid, answers: { why_trustee: '   ' } })).toEqual([
      { field: 'answers.why_trustee', code: 'required' },
    ])
    expect(
      errorsFor({
        ...valid,
        answers: { why_trustee: '🦊'.repeat(2000), experience: 'x'.repeat(2001) },
      }),
    ).toEqual([{ field: 'answers.experience', code: 'too_long' }])
  })

  it('keeps answers only when given, dropping an empty optional one', () => {
    const parsed = applySchema.parse({
      ...valid,
      answers: { why_trustee: 'Reason.', experience: '  ' },
    })
    expect(storedAnswers(parsed)).toEqual({ why_trustee: 'Reason.' })
  })

  it('treats a wrong type as a bad request', () => {
    expect(errorsFor({ ...valid, checks: 'yes' })).toBe('bad_request')
    expect(errorsFor('not an object')).toBe('bad_request')
  })

  it('sizes the body cap for the largest valid request', () => {
    const largest = JSON.stringify({
      ...valid,
      callName: '🦊'.repeat(60),
      email: `${'a'.repeat(240)}@example.org`,
      answers: { why_trustee: '🦊'.repeat(2000), experience: '🦊'.repeat(2000) },
      turnstileToken: 'X'.repeat(2048),
    })
    expect(new TextEncoder().encode(largest).length).toBeLessThanOrEqual(APPLY_BODY_CAP)
  })

  it('stores the founder-connection answer for every open role (F3)', () => {
    for (const role of publishedRoles()) {
      expect(role.apply.checks.map((check) => check.id)).toContain('connection_to_founders')
    }
  })
})
