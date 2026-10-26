import { env } from 'cloudflare:workers'

const { DB: db } = env as unknown as { DB: D1Database }

// The shared setup applies the real migrations (tests/unit/setup), so each
// test only needs an empty email_log.
export async function clearEmailLog() {
  await db.exec('DELETE FROM email_log')
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
