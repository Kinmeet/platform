import { env } from 'cloudflare:workers'

const { DB: db } = env as unknown as { DB: D1Database }

// The email_log table exactly as migrations/db/0001 in #41 creates it. Once
// #41 lands, the shared setup applies the real migrations and this goes.
export async function createEmailLog() {
  await db.exec('DROP TABLE IF EXISTS email_log')
  await db.exec(
    "CREATE TABLE email_log (id TEXT PRIMARY KEY NOT NULL, to_hmac TEXT NOT NULL CHECK (length(to_hmac) = 64 AND to_hmac NOT GLOB '*[^0-9a-f]*'), template_id TEXT NOT NULL CHECK (template_id GLOB '[a-z]*' AND template_id NOT GLOB '*[^a-z_]*'), sent_at INTEGER NOT NULL, delete_after INTEGER NOT NULL CHECK (delete_after > sent_at)) STRICT",
  )
}

export async function logRows() {
  const { results } = await db.prepare('SELECT * FROM email_log ORDER BY sent_at').all<{
    id: string
    to_hmac: string
    template_id: string
    sent_at: number
    delete_after: number
  }>()
  return results
}
