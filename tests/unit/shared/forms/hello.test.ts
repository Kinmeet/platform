import { describe, expect, it } from 'vitest'
import { toFieldErrors } from '../../../../shared/forms/errors'
import { helloSchema } from '../../../../shared/forms/hello'

// Made-up test data only.
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

function errorsFor(input: unknown) {
  const result = helloSchema.safeParse(input)
  if (result.success) return []
  const mapped = toFieldErrors(result.error.issues, input)
  return mapped.ok ? mapped.errors : 'bad_request'
}

describe('say hello schema', () => {
  it('accepts a valid submission and trims text', () => {
    const result = helloSchema.parse({ ...valid, callName: '  Test Fox  ', message: '\nHello\n' })
    expect(result.callName).toBe('Test Fox')
    expect(result.message).toBe('Hello')
  })

  it('reports missing and empty fields as required', () => {
    expect(errorsFor({ ...valid, callName: '   ', message: undefined })).toEqual([
      { field: 'callName', code: 'required' },
      { field: 'message', code: 'required' },
    ])
  })

  it('counts length in code points', () => {
    expect(errorsFor({ ...valid, callName: '🦊'.repeat(60) })).toEqual([])
    expect(errorsFor({ ...valid, callName: '🦊'.repeat(61) })).toEqual([
      { field: 'callName', code: 'too_long' },
    ])
    expect(errorsFor({ ...valid, message: 'x'.repeat(2001) })).toEqual([
      { field: 'message', code: 'too_long' },
    ])
  })

  it('checks email syntax and length', () => {
    expect(errorsFor({ ...valid, email: 'not-an-email' })).toEqual([
      { field: 'email', code: 'invalid_email' },
    ])
    expect(errorsFor({ ...valid, email: `${'x'.repeat(243)}@example.com` })).toEqual([
      { field: 'email', code: 'too_long' },
    ])
  })

  it('refuses unknown fields by name', () => {
    expect(errorsFor({ ...valid, pronouns: 'they/them', location: 'Sample Town' })).toEqual([
      { field: 'pronouns', code: 'unknown_field' },
      { field: 'location', code: 'unknown_field' },
    ])
  })

  it('treats a malformed submission id or wrong type as a bad request', () => {
    expect(errorsFor({ ...valid, submissionId: 'not-a-uuid' })).toBe('bad_request')
    expect(errorsFor({ ...valid, callName: 42 })).toBe('bad_request')
  })
})
