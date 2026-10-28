/**
 * Deletion dates for personal data, from P3 (data map and retention).
 *
 * Every row gets a `delete_after` when it is stored, so data whose P3 trigger
 * never happens (a message we never answer, an application that never reaches
 * a decision) is still deleted. Times are Unix-epoch seconds in UTC, as in the
 * D1 schema.
 */

import type { Purpose, RetentionBase } from '../../shared/privacy/purposes'

const SECONDS_PER_DAY = 24 * 60 * 60

/** Say hello messages: 12 months after our last reply. */
export const HELLO_RETENTION_MONTHS = 12
/** Applications: 6 months after the outcome is told (and the round-close backstop). */
export const APPLICATION_RETENTION_MONTHS = 6
/** Email sending log: 30 days. */
export const EMAIL_LOG_RETENTION_DAYS = 30
/** Admin audit log: 2 years (Phase 1 rule, pending a P3 row). */
export const AUDIT_LOG_RETENTION_MONTHS = 24

/** The current time in Unix-epoch seconds. */
export function nowSeconds(date: Date = new Date()): number {
  return Math.floor(date.getTime() / 1000)
}

/**
 * Adds whole calendar months in UTC. When the target month is shorter, the
 * day is clamped to its last day (31 August plus 6 months is 28 or 29
 * February), so a deletion date never spills into the month after.
 */
export function addMonths(seconds: number, months: number): number {
  const date = new Date(seconds * 1000)
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
  date.setUTCDate(Math.min(day, lastDay))
  return Math.floor(date.getTime() / 1000)
}

export function addDays(seconds: number, days: number): number {
  return seconds + days * SECONDS_PER_DAY
}

/** On insert: 12 months after receipt, so an unanswered message is still deleted. */
export function helloDeleteAfterReceipt(receivedAt: number): number {
  return addMonths(receivedAt, HELLO_RETENTION_MONTHS)
}

/** On each reply: 12 months after that reply. */
export function helloDeleteAfterReply(repliedAt: number): number {
  return addMonths(repliedAt, HELLO_RETENTION_MONTHS)
}

/**
 * On insert: the backstop of 6 months after the round closes (a proposed P3
 * change awaiting the founder's agreement). If the round has already closed,
 * or closes before the application arrives, counts from receipt instead so
 * the date is always in the future.
 */
export function applicationDeleteAfterReceipt(receivedAt: number, roundClosesAt: number): number {
  return addMonths(Math.max(receivedAt, roundClosesAt), APPLICATION_RETENTION_MONTHS)
}

/** When the outcome is told: 6 months after that date. */
export function applicationDeleteAfterOutcome(outcomeToldAt: number): number {
  return addMonths(outcomeToldAt, APPLICATION_RETENTION_MONTHS)
}

/** Email sending log: 30 days after sending. */
export function emailLogDeleteAfter(sentAt: number): number {
  return addDays(sentAt, EMAIL_LOG_RETENTION_DAYS)
}

/** Admin audit log: 2 years after the action. */
export function auditLogDeleteAfter(at: number): number {
  return addMonths(at, AUDIT_LOG_RETENTION_MONTHS)
}

/**
 * Stored forms (ADR-0010): the rule for a version is its P3 purpose's, with
 * the shorter period if the form sets one. A form can never lengthen it.
 */
export interface RetentionRule {
  base: RetentionBase
  months: number
  backstop?: 'round_close'
}

export function retentionRule(purpose: Purpose, retentionMonths?: number): RetentionRule {
  return {
    ...purpose.retention,
    months: Math.min(purpose.retention.months, retentionMonths ?? purpose.retention.months),
  }
}

/**
 * On insert. Kept until a reply: `months` after receipt. Kept until the
 * outcome is told: `months` after the round closes, or after receipt if
 * that is later, so the date is always in the future. These match
 * `helloDeleteAfterReceipt` and `applicationDeleteAfterReceipt` for the
 * seeded forms, and a test checks they do.
 */
export function deleteAfterReceipt(
  rule: RetentionRule,
  receivedAt: number,
  roundClosesAt: number,
): number {
  const from = rule.backstop === 'round_close' ? Math.max(receivedAt, roundClosesAt) : receivedAt
  return addMonths(from, rule.months)
}

/** On the event the rule counts from (each reply, or the outcome being told). */
export function deleteAfterEvent(rule: RetentionRule, at: number): number {
  return addMonths(at, rule.months)
}
