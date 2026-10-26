import { describe, expect, it } from 'vitest'
import messages from '../../../../i18n/locales/en-GB.json'
import { findRole, publishedRoles, roleKey, roles } from '../../../../shared/forms/roles'
import type { CheckQuestion, PublishedRole, RoleConfig } from '../../../../shared/forms/roles'

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

  const { page, apply } = role
  keys.push(`${base}.page.apply`)
  for (const id of page.sections)
    keys.push(`${base}.page.sections.${id}.heading`, `${base}.page.sections.${id}.body`)
  for (const id of page.glance)
    keys.push(`${base}.page.glance.${id}.label`, `${base}.page.glance.${id}.value`)
  for (const id of page.next)
    keys.push(`${base}.page.next.${id}.title`, `${base}.page.next.${id}.body`)
  if (apply.note) keys.push(`${base}.apply.note.heading`, `${base}.apply.note.body`)

  for (const question of [...apply.checks, ...apply.questions]) {
    const q = `${base}.questions.${question.id}`
    keys.push(`${q}.label`, `${q}.summary`)
    if (question.type === 'long_text') continue
    for (const choice of question.choices) keys.push(`${q}.choices.${choice}`)
    if (question.type === 'confirm' && question.link) keys.push(`${q}.link`)
    if (question.type === 'single_choice') {
      for (const [choice, outcome] of Object.entries(question.outcomes ?? {})) {
        if ('note' in outcome) keys.push(`${q}.notes.${choice}`)
      }
    }
  }
  return keys
}

/** Keys a role may have that the config doesn't require. */
function isOptionalKey(role: RoleConfig, key: string): boolean {
  if (!role.published) return false
  const ids = [...role.apply.checks, ...role.apply.questions].map((question) => question.id)
  return ids.some((id) => key === `${roleKey(role.slug)}.questions.${id}.hint`)
}

const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/
const KEBAB_CASE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

describe('role config', () => {
  it('has unique kebab-case slugs', () => {
    const slugs = roles.map((role) => role.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const slug of slugs) expect(slug).toMatch(KEBAB_CASE)
  })

  it('uses snake_case ids for tags, page parts, questions and choices', () => {
    for (const role of roles) {
      const ids = role.tags.map((tag) => tag.id)
      if (role.published) {
        ids.push(...role.page.sections, ...role.page.glance, ...role.page.next)
        for (const question of [...role.apply.checks, ...role.apply.questions]) {
          ids.push(question.id)
          if (question.type !== 'long_text') ids.push(...question.choices)
        }
      }
      for (const id of ids) expect(id, `${role.slug}: ${id}`).toMatch(SNAKE_CASE)
    }
  })

  it('has unique question ids within each role', () => {
    for (const role of publishedRoles()) {
      const ids = [...role.apply.checks, ...role.apply.questions].map((question) => question.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('only gives outcomes to choices the question has', () => {
    for (const role of publishedRoles()) {
      for (const check of role.apply.checks) {
        if (check.type !== 'single_choice') continue
        for (const choice of Object.keys(check.outcomes ?? {})) {
          expect(check.choices, `${role.slug}.${check.id}`).toContain(choice)
        }
      }
    }
  })

  it('gives every published role a page, checks and at least one question', () => {
    expect(publishedRoles().length).toBeGreaterThan(0)
    for (const role of publishedRoles()) {
      expect(role.page.sections.length, role.slug).toBeGreaterThan(0)
      expect(role.page.glance.length, role.slug).toBeGreaterThan(0)
      expect(role.page.next.length, role.slug).toBeGreaterThan(0)
      expect(role.apply.checks.length, role.slug).toBeGreaterThan(0)
      expect(role.apply.questions.length, role.slug).toBeGreaterThan(0)
    }
  })

  it('finds roles by slug', () => {
    expect(findRole('trustee')?.published).toBe(true)
    expect(findRole('no-such-role')).toBeUndefined()
  })
})

// docs/api/forms.md is the contract with Services. If one of these changes,
// the contract and the server's validation must change in the same PR.
describe('trustee contract ids', () => {
  const trustee = findRole('trustee') as PublishedRole
  const check = (id: string) => trustee.apply.checks.find((c) => c.id === id) as CheckQuestion

  it('has the step 1 checks in the contract', () => {
    expect(trustee.apply.checks.map((c) => c.id)).toEqual([
      'over_18',
      'connection_to_founders',
      'trustee_rules_confirmed',
    ])
    expect(check('over_18').choices).toEqual(['yes', 'no'])
    expect([...check('connection_to_founders').choices].sort()).toEqual([
      'friend_or_acquaintance',
      'no',
      'not_sure',
      'related_or_household',
    ])
    expect(check('trustee_rules_confirmed').choices).toEqual(['yes'])
  })

  it('stops on the answers the server refuses, with the same codes', () => {
    const over18 = check('over_18')
    const connection = check('connection_to_founders')
    expect(over18.type === 'single_choice' && over18.outcomes?.no).toEqual({ stop: 'under_18' })
    expect(
      connection.type === 'single_choice' && connection.outcomes?.related_or_household,
    ).toEqual({ stop: 'not_independent' })
  })

  it('has the step 3 questions in the contract, each at most 2000', () => {
    expect(trustee.apply.questions).toEqual([
      { id: 'why_trustee', type: 'long_text', required: true, maxLength: 2000 },
      { id: 'experience', type: 'long_text', required: false, maxLength: 2000 },
    ])
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
      const extra = leafKeys(tree, roleKey(role.slug)).filter(
        (key) => !expected.has(key) && !isOptionalKey(role, key),
      )
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
