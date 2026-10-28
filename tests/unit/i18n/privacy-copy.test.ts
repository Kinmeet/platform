import { describe, expect, it } from 'vitest'
import messages from '../../../i18n/locales/en-GB.json'
import { privacyPage } from '../../../shared/pages/privacy'

// The privacy notice (#144) is in P9's own words, with P9's gaps left out
// until the founder's M1 review closes them. It can't be published with any
// gap still open.
type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  )
}

const copy = messages.privacy as unknown as Tree & { draft?: Tree }

describe('privacy notice copy', () => {
  it.each(leaves(copy, 'privacy.'))('fills in %s', (_key, text) => {
    expect(text.trim()).not.toBe('')
  })

  // P9 marks its gaps in square brackets. None may reach the page.
  it.each(leaves(copy, 'privacy.'))('has no square-bracket gap in %s', (_key, text) => {
    expect(text).not.toMatch(/\[|\]/)
  })

  // Each gap is closed exactly when the page is published.
  it(`${privacyPage.published ? 'has' : 'waits for'} the date at the top`, () => {
    expect(privacyPage.lastUpdated !== null).toBe(privacyPage.published)
    expect(privacyPage.lastUpdated ?? '2000-01-01').toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it(`${privacyPage.published ? 'has' : 'waits for'} the role address`, () => {
    expect(privacyPage.address !== null).toBe(privacyPage.published)
    expect(privacyPage.address ?? 'role@example.org').toMatch(/^[^@\s]+@[^@\s]+\.[a-z]+$/)
  })

  it(`${privacyPage.published ? 'has no' : 'holds the'} proposed P9 edits in draft`, () => {
    const drafts = Object.keys(copy.draft ?? {})
    expect(drafts).toEqual(
      privacyPage.published
        ? []
        : [
            'scrambled_ip',
            'turnstile_what',
            'backups',
            'collect_trustee',
            'safety_what',
            'safety_why',
            'keep_hello',
            'keep_email_log',
            'keep_safety',
            'under_18_private',
          ],
    )
  })
})
