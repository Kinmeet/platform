import { env } from 'cloudflare:workers'

const { DB: db } = env as unknown as { DB: D1Database }

// The agreed email_log shape. The migration itself belongs to #27; once it
// lands, the email tests apply the real migrations instead.
export async function createEmailLog() {
  await db.exec('DROP TABLE IF EXISTS email_log')
  await db.exec(
    'CREATE TABLE email_log (id TEXT PRIMARY KEY, to_hmac TEXT NOT NULL, template_id TEXT NOT NULL, sent_at TEXT NOT NULL, delete_after TEXT NOT NULL)',
  )
}
