import { describe, expect, it } from 'vitest'
import { codePointLength, isPlausibleEmail } from '../../../../shared/forms/fields'

describe('field rules', () => {
  it('counts code points, not UTF-16 units', () => {
    expect(codePointLength('Fernfox')).toBe(7)
    expect(codePointLength('🦊🌿')).toBe(2)
    expect(codePointLength('Ŵyn')).toBe(3)
  })

  it.each(['test.organiser@example.com', 'a@b.co', 'sample+group@mail.example.org'])(
    'accepts %s',
    (email) => expect(isPlausibleEmail(email)).toBe(true),
  )

  it.each([
    'test.organiser',
    'test@example',
    '@example.com',
    'test@@example.com',
    'test @example.com',
    'test@example.com\r\nBcc: someone@example.com',
    'test@exa\u0000mple.com',
    'test@example..com',
  ])('refuses %j', (email) => expect(isPlausibleEmail(email)).toBe(false))
})
