import { beforeAll, describe, expect, it } from 'vitest'
import {
  createHelloDraft,
  helloErrorMessage,
  helloErrors,
  helloText,
  readHelloResponse,
  toHelloRequest,
} from '../../../../app/utils/hello-form'
import en from '../../../../i18n/locales/en-GB.json'
import type { PublicForm } from '../../../../shared/forms/view'
import { loadPublicForm } from '../../helpers/stored-forms'

// Say hello on its stored version (ADR-0010, A2). Made-up test data only.
let hello: PublicForm
beforeAll(async () => {
  hello = await loadPublicForm('hello')
})

const ID = '00000000-0000-4000-8000-000000000000'

function filled() {
  const draft = createHelloDraft(ID)
  draft.callName = ' Test Organiser '
  draft.email = 'test.organiser@example.com'
  draft.values.message = '  A made-up message for testing.  '
  return draft
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], en)
}

describe('helloErrors', () => {
  it('accepts a filled-in form', () => {
    expect(helloErrors(filled(), hello)).toEqual([])
  })

  it('lists every missing field, in order', () => {
    expect(helloErrors(createHelloDraft(ID), hello)).toEqual([
      { field: 'callName', code: 'required' },
      { field: 'email', code: 'required' },
      { field: 'message', code: 'required' },
    ])
  })

  it('uses the API rules for email and length', () => {
    const draft = filled()
    draft.email = 'test@example'
    draft.values.message = 'x'.repeat(2001)
    expect(helloErrors(draft, hello)).toEqual([
      { field: 'email', code: 'invalid_email' },
      { field: 'message', code: 'too_long' },
    ])
  })
})

describe('toHelloRequest', () => {
  it('sends trimmed text with the id and token', () => {
    expect(toHelloRequest(filled(), hello, 'token')).toEqual({
      submissionId: ID,
      callName: 'Test Organiser',
      email: 'test.organiser@example.com',
      message: 'A made-up message for testing.',
      turnstileToken: 'token',
    })
  })
})

describe('readHelloResponse', () => {
  it('reads every reply in the contract', () => {
    expect(readHelloResponse(201, { ok: true, receipt: 'not_requested' }, hello)).toEqual({
      kind: 'sent',
    })
    expect(readHelloResponse(200, { ok: true }, hello)).toEqual({ kind: 'sent' })
    expect(
      readHelloResponse(
        422,
        { ok: false, errors: [{ field: 'email', code: 'invalid_email' }] },
        hello,
      ),
    ).toEqual({ kind: 'invalid', errors: [{ field: 'email', code: 'invalid_email' }] })
    expect(
      readHelloResponse(
        403,
        {
          ok: false,
          errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }],
        },
        hello,
      ),
    ).toEqual({ kind: 'turnstile_failed' })
    expect(readHelloResponse(429, { ok: false, error: 'rate_limited' }, hello)).toEqual({
      kind: 'rate_limited',
    })
  })

  it.each([
    [400, { ok: false, error: 'bad_request' }],
    [413, null],
    [500, { ok: false, error: 'unavailable' }],
    [503, null],
    [422, { ok: false, errors: [{ field: 'nickname', code: 'unknown_field' }] }],
    [422, { ok: false, errors: [] }],
  ])('treats %i as a failed send', (status, body) => {
    expect(readHelloResponse(status, body, hello)).toEqual({ kind: 'failed' })
  })
})

describe('helloErrorMessage', () => {
  it('has wording for every code a field can get', () => {
    for (const [field, codes] of Object.entries({
      callName: ['required', 'too_long'],
      email: ['required', 'too_long', 'invalid_email'],
      message: ['required', 'too_long'],
    })) {
      for (const code of codes) {
        const message = helloErrorMessage({ field, code }, hello)
        expect(typeof lookup(message.key), message.key).toBe('string')
        const name =
          'text' in message.question ? message.question.text : lookup(message.question.key)
        expect(typeof name, JSON.stringify(message.question)).toBe('string')
      }
    }
  })

  it('gives the limit for text that is too long', () => {
    expect(helloErrorMessage({ field: 'message', code: 'too_long' }, hello).params).toEqual({
      max: 2000,
    })
  })
})

describe('helloText', () => {
  it('copies the name, email and message, and names no Kinmeet address', () => {
    const t = (key: string) => String(lookup(key))
    const text = helloText(filled(), hello, t)
    expect(text.split('\n')).toEqual([
      `${en.hello.fields.callName}: Test Organiser`,
      `${en.hello.fields.email}: test.organiser@example.com`,
      '',
      'A made-up message for testing.',
    ])
    expect(text).not.toMatch(/kinmeet\.|@kinmeet/i)
  })
})
