import type { D1Database } from '@cloudflare/workers-types'
import { nowSeconds } from '../retention'

/**
 * The automatic deletion job's work (P3, P1 Phase 1 "deletion tested").
 *
 * Every personal-data row carries a `delete_after` set when it was stored and
 * moved on by the admin page's actions, so the job only removes rows whose
 * date has passed. It returns counts only, never anything from a row.
 */

export interface DeletionCounts {
  hello_messages: number
  applications: number
  email_log: number
  audit_log: number
}

export async function deleteExpiredRows(
  db: D1Database,
  now: number = nowSeconds(),
): Promise<DeletionCounts> {
  // Fixed statements with a bound time; one batch, so it runs as a single transaction.
  const [hello, applications, emailLog, auditLog] = await db.batch([
    db.prepare('DELETE FROM hello_messages WHERE delete_after <= ?').bind(now),
    db.prepare('DELETE FROM applications WHERE delete_after <= ?').bind(now),
    db.prepare('DELETE FROM email_log WHERE delete_after <= ?').bind(now),
    // The audit log's trigger refuses to delete an entry before its date by
    // the database's own clock, which would abort the whole batch. Checking
    // the same clock here means a `now` ahead of it can never do that.
    db
      .prepare('DELETE FROM audit_log WHERE delete_after <= ? AND delete_after <= unixepoch()')
      .bind(now),
  ])
  return {
    hello_messages: hello?.meta.changes ?? 0,
    applications: applications?.meta.changes ?? 0,
    email_log: emailLog?.meta.changes ?? 0,
    audit_log: auditLog?.meta.changes ?? 0,
  }
}
