import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { definitionSchema, type FormDefinition } from '../../../../shared/forms/definition'
import { toFieldErrors } from '../../../../shared/forms/errors'
import { applicationSchema, bodyCapFor, storedAnswers } from '../../../../shared/forms/runtime'

// The apply contract, run through the stored application forms (ADR-0010).
// These cases were written against the hand-written apply schema, which
// #160 removed; they now hold the stored forms to the same answers.
// Made-up test data only.

let forms: {
  slug: string
  status: 'draft' | 'open' | 'closed'
  definition: FormDefinition | null
}[]
let trustee: FormDefinition
let applySchema: ReturnType<typeof applicationSchema>

beforeAll(async () => {
  const { results } = await env.DB.prepare(
    `SELECT f.slug, f.status, v.definition FROM forms AS f
     LEFT JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version
     WHERE f.kind = 'application'`,
  ).all<{ slug: string; status: 'draft' | 'open' | 'closed'; definition: string | null }>()
  forms = results.map((row) => ({
    ...row,
    definition: row.definition === null ? null : definitionSchema.parse(JSON.parse(row.definition)),
  }))
  trustee = forms.find((form) => form.slug === 'trustee')!.definition!
  applySchema = applicationSchema(forms)
})

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
    }) as Record<string, unknown>
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
    }) as Record<string, unknown>
    // The checks that can only ever be "yes" aren't kept (ADR-0010).
    expect(storedAnswers(trustee, parsed)).toEqual({
      connection_to_founders: 'not_sure',
      why_trustee: 'Reason.',
    })
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
    expect(new TextEncoder().encode(largest).length).toBeLessThanOrEqual(
      bodyCapFor(trustee, 'application'),
    )
  })

  it('stores the founder-connection answer for every open role (F3)', () => {
    const open = forms.filter((form) => form.status === 'open')
    expect(open.length).toBeGreaterThan(0)
    for (const form of open) {
      const ids = form.definition!.steps.flatMap((step) => step.fields.map((field) => field.id))
      expect(ids, form.slug).toContain('connection_to_founders')
    }
  })
})

// docs/api/forms.md is the contract with Services. If one of these changes,
// the contract and the server's validation must change in the same PR. They
// were checked against the role config until #160 moved the trustee form
// wholly into its stored version.
describe('trustee contract ids', () => {
  const fields = (stepId: string) => trustee.steps.find((step) => step.id === stepId)!.fields
  const choiceIds = (id: string) => {
    const found = trustee.steps.flatMap((step) => step.fields).find((field) => field.id === id)
    return found && 'choices' in found ? found.choices : []
  }

  it('has the step 1 checks in the contract', () => {
    expect(fields('checks').map((f) => f.id)).toEqual([
      'over_18',
      'connection_to_founders',
      'trustee_rules_confirmed',
    ])
    expect(choiceIds('over_18')).toEqual(['yes', 'no'])
    expect([...choiceIds('connection_to_founders')].sort()).toEqual([
      'friend_or_acquaintance',
      'no',
      'not_sure',
      'related_or_household',
    ])
  })

  it('stops on the answers the server refuses, with the same codes', () => {
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

  it('has the step 3 questions in the contract, each at most 2000', () => {
    expect(fields('answers')).toEqual([
      { id: 'why_trustee', type: 'long_text', required: true, maxLength: 2000 },
      { id: 'experience', type: 'long_text', required: false, maxLength: 2000 },
    ])
  })
})
