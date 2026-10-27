import type { D1Database } from '@cloudflare/workers-types'
import { emailLogDeleteAfter, nowSeconds } from '../utils/retention'
import type { EmailTemplateId } from './templates'

/**
 * One receipt per inbox per day (docs/api/forms.md, Tech Lead): counted from
 * the log itself, so there is no second store to keep.
 */
export const RECEIPT_WINDOW_SECONDS = 24 * 60 * 60

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
 * Its deletion date comes from the one home for P3 periods, `retention.ts`.
 */
export async function claimSend(
  db: D1Database,
  toHmac: string,
  template: EmailTemplateId,
  now: Date,
): Promise<boolean> {
  const sentAt = nowSeconds(now)
  const deleteAfter = emailLogDeleteAfter(sentAt)
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
