import type { D1Database } from '@cloudflare/workers-types'
import { storedAnswers, type ApplySubmission } from '../../../shared/forms/apply'
import type { StoreResult } from '../forms/process'
import { applicationDeleteAfterReceipt, nowSeconds } from '../retention'

/**
 * Storage for applications (`applications`, migrations/db/0001). Stage 1
 * only (P1): no legal details. Of the step 1 checks, only the applicant's
 * `connection_to_founders` answer is kept; the other checks can only ever be
 * "yes" once accepted. No IP, user agent or Turnstile token is stored.
 */

export async function applicationExists(db: D1Database, submissionId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM applications WHERE submission_id = ?')
    .bind(submissionId)
    .first<{ found: number }>()
  return row !== null
}

/**
 * Stores an application with its backstop deletion date: 6 months after the
 * round closes, or after receipt if that is later (P3). A second request with
 * the same `submissionId` changes nothing and reports `duplicate`, so
 * concurrent retries can never create two rows.
 */
export async function insertApplication(
  db: D1Database,
  submission: ApplySubmission,
  { roundClosesAt, now = nowSeconds() }: { roundClosesAt: number; now?: number },
): Promise<StoreResult> {
  const checks = submission.checks as Record<string, string>
  const connection = checks.connection_to_founders
  // Every open role asks this (F3); a role without it needs a schema change first.
  if (connection === undefined) throw new Error('application_connection_missing')
  const result = await db
    .prepare(
      `INSERT INTO applications
         (id, submission_id, role, connection_to_founders, call_name, email, answers,
          received_at, delete_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      submission.submissionId,
      submission.role,
      connection,
      submission.callName,
      submission.email,
      JSON.stringify(storedAnswers(submission)),
      now,
      applicationDeleteAfterReceipt(now, roundClosesAt),
    )
    .run()
  return result.meta.changes === 1 ? 'stored' : 'duplicate'
}
