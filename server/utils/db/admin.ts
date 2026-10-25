import type { D1Database } from '@cloudflare/workers-types'
import type { AdminApplication, AdminHelloMessage } from '../../../shared/admin'
import { applicationDeleteAfterOutcome, helloDeleteAfterReply, nowSeconds } from '../retention'

/**
 * Reads and the two actions for the founder's admin page (#32).
 *
 * The page is read-only apart from "mark replied" and "mark outcome told".
 * Each action records its date, moves `delete_after` on as P3 says, and
 * writes an audit log entry in the same transaction.
 */

/** Answers that mean the applicant may know a founder, so a conflict is declared. */
const CONFLICT_ANSWERS = new Set(['friend_or_acquaintance', 'not_sure'])

export async function listHelloMessages(db: D1Database): Promise<AdminHelloMessage[]> {
  const { results } = await db
    .prepare(
      `SELECT id, call_name, email, message, received_at, replied_at, delete_after
       FROM hello_messages ORDER BY received_at DESC, id`,
    )
    .all<{
      id: string
      call_name: string
      email: string
      message: string
      received_at: number
      replied_at: number | null
      delete_after: number
    }>()
  return results.map((row) => ({
    id: row.id,
    callName: row.call_name,
    email: row.email,
    message: row.message,
    receivedAt: row.received_at,
    repliedAt: row.replied_at,
    deleteAfter: row.delete_after,
  }))
}

export async function listApplications(db: D1Database): Promise<AdminApplication[]> {
  const { results } = await db
    .prepare(
      `SELECT id, role, connection_to_founders, call_name, email, answers,
              received_at, outcome_told_at, delete_after
       FROM applications ORDER BY received_at DESC, id`,
    )
    .all<{
      id: string
      role: string
      connection_to_founders: string
      call_name: string
      email: string
      answers: string
      received_at: number
      outcome_told_at: number | null
      delete_after: number
    }>()
  return results.map((row) => ({
    id: row.id,
    role: row.role,
    callName: row.call_name,
    email: row.email,
    answers: JSON.parse(row.answers) as Record<string, string>,
    conflictToDeclare: CONFLICT_ANSWERS.has(row.connection_to_founders),
    connectionToFounders: row.connection_to_founders,
    receivedAt: row.received_at,
    outcomeToldAt: row.outcome_told_at,
    deleteAfter: row.delete_after,
  }))
}

/**
 * Records a reply to a say hello message: `replied_at` is now and the
 * message is kept until 12 months after this reply. Each reply moves the
 * date on again. Returns `false` if there is no such message.
 */
export async function markReplied(
  db: D1Database,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<boolean> {
  const [update] = await db.batch([
    db
      .prepare('UPDATE hello_messages SET replied_at = ?, delete_after = ? WHERE id = ?')
      .bind(now, helloDeleteAfterReply(now), id),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id)
         SELECT ?, ?, ?, 'mark_replied', 'hello_messages', ?
         WHERE EXISTS (SELECT 1 FROM hello_messages WHERE id = ?)`,
      )
      .bind(crypto.randomUUID(), now, actor, id, id),
  ])
  return (update?.meta.changes ?? 0) === 1
}

/**
 * Records that an applicant has been told the outcome: kept until 6 months
 * after that date, replacing the round-close backstop. Only the first time
 * counts, so marking again changes nothing and writes no audit entry.
 * Returns `false` if there is no such application or it was already marked.
 */
export async function markOutcomeTold(
  db: D1Database,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<boolean> {
  const before = await db
    .prepare('SELECT outcome_told_at FROM applications WHERE id = ?')
    .bind(id)
    .first<{ outcome_told_at: number | null }>()
  if (before === null || before.outcome_told_at !== null) return false

  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE applications SET outcome_told_at = ?, delete_after = ?
         WHERE id = ? AND outcome_told_at IS NULL`,
      )
      .bind(now, applicationDeleteAfterOutcome(now), id),
    // Written only if this batch's update took effect: the row now carries
    // exactly this time, and no entry for it exists yet.
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id)
         SELECT ?, ?, ?, 'mark_outcome_told', 'applications', ?
         WHERE EXISTS (SELECT 1 FROM applications WHERE id = ? AND outcome_told_at = ?)
           AND NOT EXISTS (
             SELECT 1 FROM audit_log
             WHERE action = 'mark_outcome_told' AND target_table = 'applications' AND target_id = ?
           )`,
      )
      .bind(crypto.randomUUID(), now, actor, id, id, now, id),
  ])
  return (update?.meta.changes ?? 0) === 1
}
