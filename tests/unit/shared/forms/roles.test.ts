import { describe, expect, it } from 'vitest'
import messages from '../../../../i18n/locales/en-GB.json'
import { findRole, publishedRoles, roleKey, roles } from '../../../../shared/forms/roles'
import type { RoleConfig } from '../../../../shared/forms/roles'

type Tree = { [key: string]: string | Tree }

/** Every leaf key under `tree`, as dotted paths. */
function leafKeys(tree: Tree, prefix: string): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [`${prefix}.${key}`] : leafKeys(value, `${prefix}.${key}`),
  )
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Tree | undefined)?.[part], messages)
}

/** The wording keys a role's config says must exist. */
function expectedKeys(role: RoleConfig): string[] {
  const base = roleKey(role.slug)
  const keys = [
    `${base}.title`,
    `${base}.summary`,
    ...role.tags.map((tag) => `${base}.tags.${tag.id}`),
  ]
  if (!role.published) return keys

  const { page } = role
  keys.push(`${base}.page.apply`)
  for (const id of page.sections)
    keys.push(`${base}.page.sections.${id}.heading`, `${base}.page.sections.${id}.body`)
  for (const id of page.glance)
    keys.push(`${base}.page.glance.${id}.label`, `${base}.page.glance.${id}.value`)
  for (const id of page.next)
    keys.push(`${base}.page.next.${id}.title`, `${base}.page.next.${id}.body`)
  return keys
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

describe('role config', () => {
  it('has unique kebab-case slugs', () => {
    const slugs = roles.map((role) => role.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(KEBAB_CASE)
  })

  it('uses snake_case ids for tags and page parts', () => {
    for (const role of roles) {
      const ids = role.tags.map((tag) => tag.id)
      if (role.published) ids.push(...role.page.sections, ...role.page.glance, ...role.page.next)
      for (const id of ids) expect(id, `${role.slug}: ${id}`).toMatch(SNAKE_CASE)
    }
  })

  it('gives every published role a page', () => {
    expect(publishedRoles().length).toBeGreaterThan(0)
    for (const role of publishedRoles()) {
      expect(role.page.sections.length, role.slug).toBeGreaterThan(0)
      expect(role.page.glance.length, role.slug).toBeGreaterThan(0)
      expect(role.page.next.length, role.slug).toBeGreaterThan(0)
    }
  })

  // F3 and SG3: these officers sit on the board, so the independence rule
  // applies to them too, and their cards must say so (Ezra, #82).
  it('tags the trustee officer roles as trustee roles', () => {
    for (const slug of ['treasurer', 'safeguarding-lead']) {
      expect(
        findRole(slug)?.tags.map((tag) => tag.id),
        slug,
      ).toContain('trustee')
    }
  })

  it('finds roles by slug', () => {
    expect(findRole('trustee')?.published).toBe(true)
    expect(findRole('no-such-role')).toBeUndefined()
  })
})

describe('role wording', () => {
  it.each(roles.map((role) => [role.slug, role] as const))(
    '%s has every key its config needs',
    (_slug, role) => {
      for (const key of expectedKeys(role)) {
        const value = lookup(key)
        expect(typeof value, key).toBe('string')
        expect((value as string).trim(), key).not.toBe('')
      }
    },
  )

  // The admin page falls back to the raw id when a key is missing, so a key
  // whose id isn't in the config would silently never be shown.
  it.each(roles.map((role) => [role.slug, role] as const))(
    '%s has no keys its config does not know about',
    (_slug, role) => {
      const tree = lookup(roleKey(role.slug)) as Tree
      const expected = new Set(expectedKeys(role))
      const extra = leafKeys(tree, roleKey(role.slug)).filter((key) => !expected.has(key))
      expect(extra).toEqual([])
    },
  )

  it('has no wording for roles that are not in the config', () => {
    const slugs = new Set(roles.map((role) => role.slug))
    expect(Object.keys(messages.roles).filter((slug) => !slugs.has(slug))).toEqual([])
  })

  // vue-i18n treats { } @ | $ % as message syntax. None of our role wording
  // uses interpolation, so any of these is a mistake.
  it('uses no vue-i18n message syntax', () => {
    const offending = leafKeys(messages.roles as Tree, 'roles').filter((key) =>
      /[{}@|$%]/.test(lookup(key) as string),
    )
    expect(offending).toEqual([])
  })
})
