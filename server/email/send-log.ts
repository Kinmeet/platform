import type { D1Database } from '@cloudflare/workers-types'
import type { EmailTemplateId } from './templates'

const DAY_MS = 24 * 60 * 60 * 1000

/** P3: the email sending log is kept for 30 days. */
export const SEND_LOG_RETENTION_DAYS = 30

/**
 * The `email_log` table (migration in #27, deleted by #31) holds only an
 * HMAC of the address, the template id and two dates.
 */
export async function countRecentSends(
  db: D1Database,
  toHmac: string,
  template: EmailTemplateId,
  since: Date,
): Promise<number> {
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS sends FROM email_log WHERE to_hmac = ? AND template_id = ? AND sent_at >= ?',
    )
    .bind(toHmac, template, since.toISOString())
    .first<{ sends: number }>()
  return row?.sends ?? 0
}

export async function recordSend(
  db: D1Database,
  toHmac: string,
  template: EmailTemplateId,
  sentAt: Date,
): Promise<void> {
  const deleteAfter = new Date(sentAt.getTime() + SEND_LOG_RETENTION_DAYS * DAY_MS)
  await db
    .prepare(
      'INSERT INTO email_log (id, to_hmac, template_id, sent_at, delete_after) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(crypto.randomUUID(), toHmac, template, sentAt.toISOString(), deleteAfter.toISOString())
    .run()
}

export function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS)
}
