import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'
import { APPLY_BODY_CAP, applySchema } from '../../../../shared/forms/apply'
import { definitionSchema, type FormDefinition } from '../../../../shared/forms/definition'
import { toFieldErrors } from '../../../../shared/forms/errors'
import { HELLO_BODY_CAP, helloSchema } from '../../../../shared/forms/hello'
import {
  applicationSchema,
  bodyCapFor,
  isStored,
  storedAnswers,
  submissionSchema,
} from '../../../../shared/forms/runtime'

// The run-time schema builder (ADR-0010, #156). The seeded version 1 forms
// must behave exactly as the hand-written schemas did, so today's pages and
// API contract are unchanged. Made-up test data only.

let hello: FormDefinition
let trustee: FormDefinition

async function seeded(slug: string): Promise<FormDefinition> {
  const row = await env.DB.prepare(
    `SELECT v.definition FROM forms AS f
     JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version
     WHERE f.slug = ?`,
  )
    .bind(slug)
    .first<{ definition: string }>()
  return definitionSchema.parse(JSON.parse(row!.definition))
}

beforeAll(async () => {
  hello = await seeded('hello')
  trustee = await seeded('trustee')
})

/** What a schema makes of a body: the parsed data, or the API's field errors. */
function outcome(schema: { safeParse: (input: unknown) => unknown }, input: unknown) {
  const result = schema.safeParse(input) as
    | { success: true; data: unknown }
    | { success: false; error: { issues: Parameters<typeof toFieldErrors>[0] } }
  return result.success
    ? { data: result.data }
    : { errors: toFieldErrors(result.error.issues, input) }
}

const helloValid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

const helloCases: [string, unknown][] = [
  ['valid', helloValid],
  ['trimmed', { ...helloValid, callName: '  Test Fox  ', message: '\nHello\n' }],
  ['message at the limit', { ...helloValid, message: 'é'.repeat(2000) }],
  ['message over the limit', { ...helloValid, message: '🦊'.repeat(2001) }],
  ['blank message', { ...helloValid, message: '   ' }],
  ['no message', { ...helloValid, message: undefined }],
  ['message not text', { ...helloValid, message: 5 }],
  ['blank call name', { ...helloValid, callName: '' }],
  ['long call name', { ...helloValid, callName: 'x'.repeat(61) }],
  ['bad email', { ...helloValid, email: 'not-an-email' }],
  ['email with a line break', { ...helloValid, email: 'a@example.com\nBcc: b@example.com' }],
  ['email with a double dot', { ...helloValid, email: 'a@example..org' }],
  ['extra field', { ...helloValid, age: '12' }],
  ['many extra fields', Object.fromEntries([...Array(20)].map((_, i) => [`k${i}`, 'x']))],
  ['bad submission id', { ...helloValid, submissionId: 'not-a-uuid' }],
  ['no token', { ...helloValid, turnstileToken: '' }],
  ['long token', { ...helloValid, turnstileToken: 'x'.repeat(2049) }],
  ['answers object at the top', { ...helloValid, answers: { message: 'x' } }],
  ['not an object', 'hello'],
  ['null', null],
]

const applyValid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  role: 'trustee',
  checks: { over_18: 'yes', connection_to_founders: 'not_sure', trustee_rules_confirmed: 'yes' },
  callName: 'Sample Applicant',
  email: 'sample.applicant@example.org',
  answers: { why_trustee: 'A made-up reason.', experience: '' },
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

const withChecks = (checks: Record<string, unknown>) => ({
  ...applyValid,
  checks: { ...applyValid.checks, ...checks },
})
const withAnswers = (answers: Record<string, unknown>) => ({
  ...applyValid,
  answers: { ...applyValid.answers, ...answers },
})

const applyCases: [string, unknown][] = [
  ['valid', applyValid],
  ['experience left out', { ...applyValid, answers: { why_trustee: 'Reason.' } }],
  ['experience blank', withAnswers({ experience: '   ' })],
  ['experience too long', withAnswers({ experience: 'x'.repeat(2001) })],
  ['why missing', { ...applyValid, answers: { experience: 'Some.' } }],
  ['why blank', withAnswers({ why_trustee: ' ' })],
  ['why too long', withAnswers({ why_trustee: 'x'.repeat(2001) })],
  ['unknown answer', withAnswers({ age: '30' })],
  ['under 18', withChecks({ over_18: 'no' })],
  ['not independent', withChecks({ connection_to_founders: 'related_or_household' })],
  ['friend', withChecks({ connection_to_founders: 'friend_or_acquaintance' })],
  ['made-up choice', withChecks({ connection_to_founders: 'maybe' })],
  ['rules not ticked', withChecks({ trustee_rules_confirmed: 'no' })],
  ['rules missing', { ...applyValid, checks: { over_18: 'yes', connection_to_founders: 'no' } }],
  ['unknown check', withChecks({ shoe_size: '9' })],
  ['no checks', { ...applyValid, checks: undefined }],
  ['checks not an object', { ...applyValid, checks: 'yes' }],
  ['unknown role', { ...applyValid, role: 'wizard' }],
  ['closed role', { ...applyValid, role: 'treasurer' }],
  ['role missing', { ...applyValid, role: undefined }],
  ['role not text', { ...applyValid, role: 7 }],
  ['role in capitals', { ...applyValid, role: 'TRUSTEE' }],
  ['extra top-level field', { ...applyValid, legalName: 'x' }],
  ['bad email', { ...applyValid, email: 'nope' }],
  ['several problems', { ...withChecks({ over_18: 'no' }), callName: '', email: 'x' }],
]

function applicationForms() {
  return applicationSchema([
    { slug: 'artist-mark', status: 'draft', definition: null },
    { slug: 'treasurer', status: 'draft', definition: null },
    { slug: 'trustee', status: 'open', definition: trustee },
  ])
}

describe('the seeded forms against the old schemas', () => {
  it.each(helloCases)('say hello: %s', (_name, input) => {
    const built = submissionSchema(hello, { kind: 'form', slug: 'hello' })
    expect(outcome(built, input)).toEqual(outcome(helloSchema, input))
  })

  it.each(applyCases)('apply: %s', (_name, input) => {
    expect(outcome(applicationForms(), input)).toEqual(outcome(applySchema, input))
  })

  it('stores the same answers as before', () => {
    const parsed = applicationForms().parse(applyValid) as Record<string, unknown>
    // `experience` was empty, so it is left out; the two checks that can only
    // ever be "yes" are not kept, as before.
    expect(storedAnswers(trustee, parsed)).toEqual({
      connection_to_founders: 'not_sure',
      why_trustee: 'A made-up reason.',
    })
    const message = submissionSchema(hello, { kind: 'form', slug: 'hello' }).parse({
      ...helloValid,
      message: '  Trimmed.  ',
    }) as Record<string, unknown>
    expect(storedAnswers(hello, message)).toEqual({ message: 'Trimmed.' })
  })

  it('works out the same body caps', () => {
    expect(bodyCapFor(hello, 'form')).toBe(HELLO_BODY_CAP)
    expect(bodyCapFor(trustee, 'application')).toBe(APPLY_BODY_CAP)
  })
})

/** A fixture with every field type and a show-if condition. Made-up wording lives elsewhere. */
const fixture: FormDefinition = definitionSchema.parse({
  steps: [
    {
      id: 'first',
      body: 'checks',
      fields: [
        {
          id: 'has_group',
          type: 'single_choice',
          required: true,
          choices: ['yes', 'no', 'too_young'],
          outcomes: { too_young: { stop: 'under_18' } },
        },
        { id: 'agree', type: 'confirm', required: true },
      ],
    },
    {
      id: 'second',
      body: 'answers',
      fields: [
        {
          id: 'group_name',
          type: 'short_text',
          required: true,
          maxLength: 80,
          showIf: { field: 'has_group', in: ['yes'] },
        },
        { id: 'contact_email', type: 'email', required: false },
        { id: 'helper_name', type: 'call_name', required: false },
        { id: 'notes', type: 'long_text', required: false, maxLength: 500 },
      ],
    },
  ],
  aboutYou: 2,
  note: false,
  receipt: 'none',
  actions: ['reply', 'pass_to_safeguarding'],
  readers: ['central_team'],
})

const fixtureSchema = submissionSchema(fixture, { kind: 'form', slug: 'sample-form' })
const fixtureValid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  checks: { has_group: 'yes', agree: 'yes' },
  answers: { group_name: 'Sample Group' },
  callName: 'Test Organiser',
  email: 'test.organiser@example.org',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

describe('the run-time schema for any version', () => {
  it('accepts a valid body', () => {
    expect(fixtureSchema.safeParse(fixtureValid).success).toBe(true)
  })

  it('requires a shown field and refuses an answer to a hidden one (Nadia, Ezra)', () => {
    const missing = { ...fixtureValid, answers: {} }
    expect(outcome(fixtureSchema, missing)).toEqual({
      errors: { ok: true, errors: [{ field: 'answers.group_name', code: 'required' }] },
    })
    const hidden = { ...fixtureValid, checks: { has_group: 'no', agree: 'yes' } }
    expect(outcome(fixtureSchema, hidden)).toEqual({
      errors: { ok: true, errors: [{ field: 'answers.group_name', code: 'unknown_field' }] },
    })
    const fine = { ...hidden, answers: {} }
    expect(fixtureSchema.safeParse(fine).success).toBe(true)
  })

  it('refuses an id that every object already has, such as constructor (Nadia)', () => {
    // A missing answer would find Object.prototype's value instead.
    const withField = {
      ...fixture,
      steps: [
        fixture.steps[0],
        {
          ...fixture.steps[1],
          fields: [{ id: 'constructor', type: 'short_text', required: false, maxLength: 80 }],
        },
      ],
    }
    const withChoice = {
      ...fixture,
      steps: [
        {
          ...fixture.steps[0],
          fields: [
            { ...fixture.steps[0]!.fields[0]!, choices: ['yes', 'constructor'], outcomes: {} },
            fixture.steps[0]!.fields[1],
          ],
        },
        fixture.steps[1],
      ],
    }
    for (const candidate of [withField, withChoice]) {
      const result = definitionSchema.safeParse(candidate)
      expect(result.success).toBe(false)
      expect(result.error!.issues.map((issue) => issue.message)).toContain('reserved_id')
    }
  })

  it('reads only answers the body itself holds', () => {
    // Belt and braces with the id rule above: the body check never looks
    // past the body's own keys.
    const definition = {
      ...fixture,
      steps: [fixture.steps[0]!, { ...fixture.steps[1]!, fields: [] }],
    } as FormDefinition
    const inherited = Object.create({ has_group: 'yes' }) as Record<string, unknown>
    expect(storedAnswers(definition, { checks: inherited })).toEqual({})
  })

  it('treats a blank optional email or name as not answered, and checks one that is given', () => {
    const blank = { ...fixtureValid, answers: { ...fixtureValid.answers, contact_email: ' ' } }
    expect(fixtureSchema.safeParse(blank).success).toBe(true)
    const bad = { ...fixtureValid, answers: { ...fixtureValid.answers, contact_email: 'nope' } }
    expect(outcome(fixtureSchema, bad)).toEqual({
      errors: { ok: true, errors: [{ field: 'answers.contact_email', code: 'invalid_email' }] },
    })
    const long = {
      ...fixtureValid,
      answers: { ...fixtureValid.answers, helper_name: 'x'.repeat(61) },
    }
    expect(outcome(fixtureSchema, long)).toEqual({
      errors: { ok: true, errors: [{ field: 'answers.helper_name', code: 'too_long' }] },
    })
  })

  it('stops on a stop outcome and refuses a short text over its own length', () => {
    const young = { ...fixtureValid, checks: { has_group: 'too_young', agree: 'yes' } }
    expect(outcome(fixtureSchema, young)).toMatchObject({
      errors: { errors: expect.arrayContaining([{ field: 'checks.has_group', code: 'under_18' }]) },
    })
    const long = { ...fixtureValid, answers: { group_name: 'x'.repeat(81) } }
    expect(outcome(fixtureSchema, long)).toEqual({
      errors: { ok: true, errors: [{ field: 'answers.group_name', code: 'too_long' }] },
    })
  })

  it('stores only answers that say something', () => {
    expect(isStored(fixture.steps[0]!.fields[0]!)).toBe(true)
    expect(isStored(fixture.steps[0]!.fields[1]!)).toBe(false)
    const parsed = fixtureSchema.parse({
      ...fixtureValid,
      answers: { group_name: 'Sample Group', notes: '' },
    }) as Record<string, unknown>
    expect(storedAnswers(fixture, parsed)).toEqual({
      has_group: 'yes',
      group_name: 'Sample Group',
    })
  })

  it('puts "About you" where the version says', () => {
    expect(Object.keys(fixtureSchema.shape)).toEqual([
      'submissionId',
      'checks',
      'answers',
      'callName',
      'email',
      'turnstileToken',
    ])
  })

  it('refuses every role when no application form is open', () => {
    const none = applicationSchema([{ slug: 'trustee', status: 'closed', definition: trustee }])
    expect(outcome(none, applyValid)).toEqual({
      errors: { ok: true, errors: [{ field: 'role', code: 'role_closed' }] },
    })
  })
})
