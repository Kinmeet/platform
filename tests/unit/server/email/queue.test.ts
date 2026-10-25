import { env } from 'cloudflare:workers'
import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueEmail } from '../../../../server/utils/email'

const db = (env as unknown as { DB: D1Database }).DB
const request = {
  to: 'fernfox@example.org',
  template: 'application_receipt',
  locale: 'en-GB',
} as const

function fakeEvent(cloudflareEnv: Record<string, unknown> | undefined) {
  const pending: Promise<unknown>[] = []
  const event = {
    context: { cloudflare: cloudflareEnv ? { env: cloudflareEnv } : undefined },
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as H3Event
  return { event, settled: () => Promise.all(pending) }
}

describe('queueEmail', () => {
  beforeEach(async () => {
    await db.exec('DROP TABLE IF EXISTS email_log')
    await db.exec(
      'CREATE TABLE email_log (id TEXT PRIMARY KEY, to_hmac TEXT NOT NULL, template_id TEXT NOT NULL, sent_at TEXT NOT NULL, delete_after TEXT NOT NULL)',
    )
    vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('hands the work to waitUntil and logs the send', async () => {
    const { event, settled } = fakeEvent({ DB: db, EMAIL_LOG_HMAC_KEY: 'test-only-key' })
    expect(queueEmail(event, request)).toBeUndefined()
    await settled()
    const row = await db.prepare('SELECT COUNT(*) AS n FROM email_log').first<{ n: number }>()
    expect(row?.n).toBe(1)
  })

  it('never throws, and logs only a code when something is missing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const cloudflareEnv of [
      undefined,
      { DB: db },
      { DB: db, EMAIL_LOG_HMAC_KEY: 'k', EMAIL_TRANSPORT: 'smtp' },
    ]) {
      const { event, settled } = fakeEvent(cloudflareEnv)
      expect(() => queueEmail(event, request)).not.toThrow()
      await settled()
    }
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toContain('email_db_missing')
    expect(logged).toContain('email_log_hmac_key_missing')
    expect(logged).toContain('email_transport_unknown')
    expect(logged).not.toContain('example.org')
  })
})
