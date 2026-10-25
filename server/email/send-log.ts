import type { D1Database } from '@cloudflare/workers-types'
import type { EmailTemplateId } from './templates'

const DAY_SECONDS = 24 * 60 * 60

/** P3: the email sending log is kept for 30 days. */
export const SEND_LOG_RETENTION_DAYS = 30

/**
 * One receipt per inbox per day (docs/api/forms.md, Tech Lead): counted from
 * the log itself, so there is no second store to keep.
 */
export const RECEIPT_WINDOW_SECONDS = DAY_SECONDS

/**
 * Writes the `email_log` row for a send, unless the same `to_hmac` already
 * has a row from the last 24 hours. Returns false when it was over the limit.
 *
 * The check and the insert are one statement, and D1 runs writes one at a
 * time, so two submissions at the same moment cannot both pass. The row is
 * written when the email is queued, so a send that later fails still counts:
 * that fails safe against filling a stranger's inbox.
 *
 * The table (migration in #41, deleted by #31) holds only the HMAC of the
 * address in inbox form, the template id and two dates, in Unix seconds.
 */
export async function claimSend(
  db: D1Database,
  toHmac: string,
  template: EmailTemplateId,
  now: Date,
): Promise<boolean> {
  const sentAt = Math.floor(now.getTime() / 1000)
  const deleteAfter = sentAt + SEND_LOG_RETENTION_DAYS * DAY_SECONDS
  const result = await db
    .prepare(
      `INSERT INTO email_log (id, to_hmac, template_id, sent_at, delete_after)
       SELECT ?, ?, ?, ?, ?
       WHERE NOT EXISTS (SELECT 1 FROM email_log WHERE to_hmac = ? AND sent_at > ?)`,
    )
    .bind(
      crypto.randomUUID(),
      toHmac,
      template,
      sentAt,
      deleteAfter,
      toHmac,
      sentAt - RECEIPT_WINDOW_SECONDS,
    )
    .run()
  return result.meta.changes === 1
}
