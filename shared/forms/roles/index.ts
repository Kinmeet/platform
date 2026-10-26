import { trustee } from './trustee'
import type { DraftRole, PublishedRole, RoleConfig } from './types'

export type * from './types'

// Listed on the home page, not open yet (Q3). Each gets its own file, with a
// page and questions, when its content is agreed.
const artistMark = {
  slug: 'artist-mark',
  published: false,
  tags: [
    { id: 'paid', style: 'paid' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
} as const satisfies DraftRole

const artistIllustration = {
  slug: 'artist-illustration',
  published: false,
  tags: [
    { id: 'paid', style: 'paid' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
} as const satisfies DraftRole

const safeguardingLead = {
  slug: 'safeguarding-lead',
  published: false,
  tags: [
    { id: 'volunteer', style: 'info' },
    { id: 'trustee', style: 'info' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
} as const satisfies DraftRole

const treasurer = {
  slug: 'treasurer',
  published: false,
  tags: [
    { id: 'volunteer', style: 'info' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
} as const satisfies DraftRole

// Must stay a draft until P3 has a row for pilot group lead applications.
// Its form should then ask for a town or area, never an address.
const pilotGroupLead = {
  slug: 'pilot-group-lead',
  published: false,
  tags: [
    { id: 'volunteer', style: 'info' },
    { id: 'how_many', style: 'info' },
    { id: 'time', style: 'info' },
  ],
} as const satisfies DraftRole

/** Every role, in the order the home page lists them. */
export const roles: readonly RoleConfig[] = [
  trustee,
  artistMark,
  artistIllustration,
  safeguardingLead,
  treasurer,
  pilotGroupLead,
]

/** The role for a slug, or undefined if there is none. */
export function findRole(slug: string): RoleConfig | undefined {
  return roles.find((role) => role.slug === slug)
}

/** Roles with a page and an open application form. */
export function publishedRoles(): PublishedRole[] {
  return roles.filter((role): role is PublishedRole => role.published)
}

/** The translation key prefix for a role: `roles.<slug>`. */
export function roleKey(slug: string): string {
  return `roles.${slug}`
}

export { trustee }
