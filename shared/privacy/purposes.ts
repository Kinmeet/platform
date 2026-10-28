import type { FieldType } from '../forms/definition'
import type { P4Role } from './roles'

/**
 * P3 purposes that stored forms may collect for (ADR-0010).
 *
 * One entry per P3 row. Area 5 owns the rules, so this is a reviewed list in
 * code, never data: an admin building a form picks a purpose and may only
 * shorten its retention and narrow its readers, never lengthen or widen
 * them. A purpose that isn't here can't be collected, so nothing waiting on
 * area 5 (the mailing list, the SG4 self-declaration) can be built early.
 *
 * Every change here needs the Privacy and Safeguarding Reviewer.
 */

/** What starts a row's retention period. */
export type RetentionBase =
  /** Kept until `months` after the last reply, counted from receipt until a reply. */
  | 'replied'
  /** Kept until `months` after the outcome is told, with a backstop until then. */
  | 'outcome_told'

export interface Purpose {
  /** The P3 row's name, as P3 writes it. */
  p3Row: string
  lawfulBasis: 'legitimate_interests'
  /** Which kind of form may use it. */
  kind: 'form' | 'application'
  retention: {
    base: RetentionBase
    months: number
    /**
     * For `outcome_told`: until the outcome is told, the row is kept until
     * `months` after the round closes, or after receipt if that is later.
     */
    backstop?: 'round_close'
  }
  fieldTypes: readonly FieldType[]
  /** Whether people can write their own words. Forces "pass to safeguarding" (SG6). */
  freeText: boolean
  /** The widest set of P4 roles that may read what it collects. */
  readers: readonly P4Role[]
}

export const purposes = {
  // P3 "Say hello messages": central team (P4 "Forms": central team and
  // secretary view), legitimate interests, 12 months after the last reply.
  say_hello: {
    p3Row: 'Say hello messages',
    lawfulBasis: 'legitimate_interests',
    kind: 'form',
    retention: { base: 'replied', months: 12 },
    fieldTypes: ['short_text', 'long_text'],
    freeText: true,
    readers: ['central_team', 'secretary'],
  },
  // P3 "Trustee applications, stage 1": legitimate interests, 6 months after
  // the decision, with the round-close backstop (#80). P4 "Trustee
  // applications": the secretary, the safeguarding lead and deputy, and the chair.
  trustee_application: {
    p3Row: 'Trustee applications, stage 1',
    lawfulBasis: 'legitimate_interests',
    kind: 'application',
    retention: { base: 'outcome_told', months: 6, backstop: 'round_close' },
    fieldTypes: ['short_text', 'long_text', 'single_choice', 'confirm'],
    freeText: true,
    readers: ['secretary', 'safeguarding_lead', 'chair'],
  },
} as const satisfies Record<string, Purpose>

export type PurposeId = keyof typeof purposes

export function findPurpose(id: string): Purpose | undefined {
  return Object.hasOwn(purposes, id) ? purposes[id as PurposeId] : undefined
}
