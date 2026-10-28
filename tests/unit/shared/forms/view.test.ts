import { beforeAll, describe, expect, it } from 'vitest'
import { definitionSchema, type FormShape } from '../../../../shared/forms/definition'
import {
  allFieldPaths,
  clearFormDraft,
  createFormDraft,
  draftErrors,
  fieldAt,
  flowFieldPaths,
  flowSteps,
  shownFieldIds,
  stopReasonOf,
  toRequestBody,
  type PublicForm,
} from '../../../../shared/forms/view'
import { loadPublicForm } from '../../helpers/stored-forms'

// The page side of stored forms (ADR-0010, A2). Made-up test data only.

let hello: PublicForm
let trustee: PublicForm

beforeAll(async () => {
  hello = await loadPublicForm('hello')
  trustee = await loadPublicForm('trustee')
})

const ID = '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d'

describe('the steps of a form', () => {
  it('puts "About you" where the version says, then Check and send', () => {
    expect(flowSteps(trustee.definition).map((flow) => flow.kind)).toEqual([
      'fields',
      'about_you',
      'fields',
      'check',
    ])
    expect(allFieldPaths(trustee.definition)).toEqual([
      'checks.over_18',
      'checks.connection_to_founders',
      'checks.trustee_rules_confirmed',
      'callName',
      'email',
      'answers.why_trustee',
      'answers.experience',
    ])
    expect(allFieldPaths(hello.definition)).toEqual(['callName', 'email', 'message'])
    expect(flowFieldPaths({ kind: 'check' })).toEqual([])
  })

  it('finds a stored field by its request name', () => {
    expect(fieldAt(trustee.definition, 'answers.why_trustee')?.type).toBe('long_text')
    expect(fieldAt(hello.definition, 'message')?.type).toBe('long_text')
    expect(fieldAt(trustee.definition, 'why_trustee')).toBeUndefined()
    expect(fieldAt(trustee.definition, 'callName')).toBeUndefined()
  })
})

describe('the request body', () => {
  it('matches the say hello contract, in order', () => {
    const draft = createFormDraft(ID)
    Object.assign(draft, { callName: ' Test Fox ', email: 'test.fox@example.com' })
    draft.values.message = ' Hello. '
    expect(Object.entries(toRequestBody(hello, draft, 'XXXX.DUMMY.TOKEN.XXXX'))).toEqual([
      ['submissionId', ID],
      ['callName', 'Test Fox'],
      ['email', 'test.fox@example.com'],
      ['message', 'Hello.'],
      ['turnstileToken', 'XXXX.DUMMY.TOKEN.XXXX'],
    ])
  })

  it('matches the apply contract, in order, leaving out empty answers', () => {
    const draft = createFormDraft(ID)
    Object.assign(draft, { callName: 'Sample Applicant', email: 'sample@example.org' })
    Object.assign(draft.values, {
      over_18: 'yes',
      connection_to_founders: 'no',
      trustee_rules_confirmed: 'yes',
      why_trustee: 'A made-up reason.',
      experience: '   ',
    })
    expect(toRequestBody(trustee, draft, 'token')).toEqual({
      submissionId: ID,
      role: 'trustee',
      checks: { over_18: 'yes', connection_to_founders: 'no', trustee_rules_confirmed: 'yes' },
      callName: 'Sample Applicant',
      email: 'sample@example.org',
      answers: { why_trustee: 'A made-up reason.' },
      turnstileToken: 'token',
    })
    expect(Object.keys(toRequestBody(trustee, draft, 'token'))).toEqual([
      'submissionId',
      'role',
      'checks',
      'callName',
      'email',
      'answers',
      'turnstileToken',
    ])
  })

  it('clears a draft and gives it a new id', () => {
    const draft = createFormDraft(ID)
    Object.assign(draft, { callName: 'Test Fox', email: 'x@example.com', values: { a: 'b' } })
    clearFormDraft(draft, '00000000-0000-4000-8000-000000000001')
    expect(draft).toEqual({
      submissionId: '00000000-0000-4000-8000-000000000001',
      callName: '',
      email: '',
      values: {},
    })
  })
})

describe('checking a draft with the server schema', () => {
  it('names every problem in the order the form shows it', () => {
    expect(draftErrors(trustee, createFormDraft(ID))).toEqual([
      { field: 'checks.over_18', code: 'required' },
      { field: 'checks.connection_to_founders', code: 'required' },
      { field: 'checks.trustee_rules_confirmed', code: 'required' },
      { field: 'callName', code: 'required' },
      { field: 'email', code: 'required' },
      { field: 'answers.why_trustee', code: 'required' },
    ])
  })

  it('checks only the fields asked for', () => {
    const draft = createFormDraft(ID)
    draft.email = 'test@example'
    expect(draftErrors(trustee, draft, ['callName', 'email'])).toEqual([
      { field: 'callName', code: 'required' },
      { field: 'email', code: 'invalid_email' },
    ])
  })

  it('uses the version’s own limits', () => {
    const draft = createFormDraft(ID)
    Object.assign(draft, { callName: 'Test Fox', email: 'test.fox@example.com' })
    draft.values.message = 'x'.repeat(2001)
    expect(draftErrors(hello, draft)).toEqual([{ field: 'message', code: 'too_long' }])
    draft.values.message = '🦊'.repeat(2000)
    expect(draftErrors(hello, draft)).toEqual([])
  })

  it('leaves a stop to the stop page', () => {
    const draft = createFormDraft(ID)
    draft.values.over_18 = 'no'
    expect(draftErrors(trustee, draft, ['checks.over_18'])).toEqual([])
    expect(stopReasonOf(trustee.definition, draft.values)).toBe('under_18')
    draft.values.over_18 = 'yes'
    draft.values.connection_to_founders = 'related_or_household'
    expect(stopReasonOf(trustee.definition, draft.values)).toBe('not_independent')
    draft.values.connection_to_founders = 'not_sure'
    expect(stopReasonOf(trustee.definition, draft.values)).toBeUndefined()
  })
})

describe('show-if questions', () => {
  const shape: FormShape = definitionSchema.parse({
    steps: [
      {
        id: 'group',
        body: 'answers',
        fields: [
          {
            id: 'has_group',
            type: 'single_choice',
            required: true,
            choices: ['yes', 'no'],
          },
          {
            id: 'group_size',
            type: 'single_choice',
            required: true,
            choices: ['small', 'large'],
            showIf: { field: 'has_group', in: ['yes'] },
          },
          {
            id: 'large_group_note',
            type: 'short_text',
            required: true,
            maxLength: 80,
            showIf: { field: 'group_size', in: ['large'] },
          },
        ],
      },
    ],
    aboutYou: 1,
    note: false,
    receipt: 'none',
    actions: ['reply', 'pass_to_safeguarding'],
    readers: ['central_team'],
  })
  const form = { slug: 'sample-form', kind: 'form' as const, definition: shape }

  it('hides a chain together when its first trigger changes', () => {
    const values = { has_group: 'yes', group_size: 'large', large_group_note: 'Sample Group' }
    expect([...shownFieldIds(shape, values)]).toEqual([
      'has_group',
      'group_size',
      'large_group_note',
    ])
    expect([...shownFieldIds(shape, { ...values, has_group: 'no' })]).toEqual(['has_group'])
  })

  it('never sends or checks a hidden answer', () => {
    const draft = createFormDraft(ID)
    Object.assign(draft, { callName: 'Test Organiser', email: 'test@example.org' })
    Object.assign(draft.values, {
      has_group: 'no',
      group_size: 'large',
      large_group_note: 'Left over',
    })
    expect(toRequestBody(form, draft, 'token').answers).toEqual({ has_group: 'no' })
    expect(draftErrors(form, draft)).toEqual([])
    draft.values.has_group = 'yes'
    draft.values.group_size = ''
    expect(draftErrors(form, draft)).toEqual([{ field: 'answers.group_size', code: 'required' }])
  })
})
