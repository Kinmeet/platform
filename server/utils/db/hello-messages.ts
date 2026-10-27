import type { D1Database } from '@cloudflare/workers-types'
import type { HelloSubmission } from '../../../shared/forms/hello'
import type { StoreResult } from '../forms/process'
import { helloDeleteAfterReceipt, nowSeconds } from '../retention'

/**
 * Storage for say hello messages (`hello_messages`, migrations/db/0001).
 * Only the fields in P3 are stored: no IP, user agent or Turnstile token.
 */

export async function helloMessageExists(db: D1Database, submissionId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM hello_messages WHERE submission_id = ?')
    .bind(submissionId)
    .first<{ found: number }>()
  return row !== null
}

/**
 * Stores a message with its deletion date of 12 months after receipt. A
 * second request with the same `submissionId` changes nothing and reports
 * `duplicate`, so concurrent retries can never create two rows.
 */
export async function insertHelloMessage(
  db: D1Database,
  submission: HelloSubmission,
  now: number = nowSeconds(),
): Promise<StoreResult> {
  const result = await db
    .prepare(
      `INSERT INTO hello_messages
         (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      submission.submissionId,
      submission.callName,
      submission.email,
      submission.message,
      now,
      helloDeleteAfterReceipt(now),
    )
    .run()
  return result.meta.changes === 1 ? 'stored' : 'duplicate'
}
