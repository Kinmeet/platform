/**
 * The P4 roles (Roles and access matrix). Roles add up: a person holding
 * several gets the sum, and every role is checked on the server. Before
 * trustees exist the founder holds every role (P4, Phase 1 exception).
 *
 * Reviewed code only: a new role is a P4 change first.
 */
export const p4Roles = [
  'organiser',
  'group_safeguarding_contact',
  'central_team',
  'secretary',
  'treasurer',
  /** The safeguarding lead and deputy, who see the same things (P4, SG6). */
  'safeguarding_lead',
  'trustee',
  /** A trustee holding the chair, where P4 says "View (chair)". */
  'chair',
  'developer',
] as const

export type P4Role = (typeof p4Roles)[number]
