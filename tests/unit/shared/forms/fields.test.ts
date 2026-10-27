import { describe, expect, it } from 'vitest'
import { email } from '../../../../shared/forms/fields'

// The shared email rule (#98): a basic syntax check, used by the page and
// the server alike (ADR-0005). Made-up addresses only.
const valid = (value: string) => email.safeParse(value).success

describe('email', () => {
  it.each([
    'test.fox@example.com',
    'sample+kinmeet@example.org',
    'a@b.co',
    'test@mail.example.org',
    'test@xn--exmple-cua.org',
    'tést@exämple.org',
    'test@example-group.org.uk',
    '  test@example.org  ',
  ])('accepts %s', (value) => {
    expect(valid(value)).toBe(true)
  })

  it.each([
    'test@example..org',
    'test@example.org.',
    'test@.example.org',
    'test@example.',
    'test@example',
    'test@@example.org',
    '@example.org',
    'test@',
    'test example@example.org',
    'test@exa mple.org',
  ])('refuses %s', (value) => {
    expect(valid(value)).toBe(false)
  })
})
