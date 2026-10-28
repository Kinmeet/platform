import { describe, expect, it } from 'vitest'
import messages from '../../../i18n/locales/en-GB.json'
import { accessibilityPage } from '../../../shared/pages/accessibility'

// The accessibility statement (#145) is in P11's own words, with P11's gaps
// left out until the founder's M1 review closes them. It can't be published
// with any gap still open.
type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  )
}

const copy = messages.accessibility
// P11's "[List known problems here, or say that none are known.]", one
// sentence per item.
const known = copy.known.items as string[]
const texts = leaves(copy as unknown as Tree, 'accessibility.')

describe('accessibility statement copy', () => {
  it.each(texts)('fills in %s', (_key, text) => {
    expect(text.trim()).not.toBe('')
  })

  // P11 marks its gaps in square brackets. None may reach the page.
  it.each(texts)('has no square-bracket gap in %s', (_key, text) => {
    expect(text).not.toMatch(/\[|\]/)
  })

  // Each gap is closed exactly when the page is published.
  it(`${accessibilityPage.published ? 'has' : 'waits for'} the known problems`, () => {
    expect(known.length > 0).toBe(accessibilityPage.published)
  })

  it(`${accessibilityPage.published ? 'has' : 'waits for'} the date at the top`, () => {
    expect(accessibilityPage.lastReviewed !== null).toBe(accessibilityPage.published)
    expect(accessibilityPage.lastReviewed ?? '2000-01-01').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it(`${accessibilityPage.published ? 'has' : 'waits for'} the role address`, () => {
    expect(accessibilityPage.address !== null).toBe(accessibilityPage.published)
    expect(accessibilityPage.address ?? 'role@example.org').toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
  })
})
