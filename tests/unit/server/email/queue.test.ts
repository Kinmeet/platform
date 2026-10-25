import { env } from 'cloudflare:workers'
import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { queueEmail } from '../../../../server/utils/email'
import { createEmailLog } from './email-log'

const { DB: db, RECEIPTS: kv } = env as unknown as { DB: D1Database; RECEIPTS: KVNamespace }
const key = 'test-only-key'
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

async function sends() {
  const row = await db.prepare('SELECT COUNT(*) AS n FROM email_log').first<{ n: number }>()
  return row?.n
}

describe('queueEmail', () => {
  beforeEach(async () => {
    await createEmailLog()
    const { keys } = await kv.list()
    await Promise.all(keys.map((k) => kv.delete(k.name)))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('answers queued and sends after the response', async () => {
    const { event, settled } = fakeEvent({ DB: db, RECEIPTS: kv, EMAIL_LOG_HMAC_KEY: key })
    expect(await queueEmail(event, request)).toBe('queued')
    await settled()
    expect(await sends()).toBe(1)
  })

  it('answers not_requested for a second receipt to the same address that day', async () => {
    const cfEnv = { DB: db, RECEIPTS: kv, EMAIL_LOG_HMAC_KEY: key }
    const first = fakeEvent(cfEnv)
    expect(await queueEmail(first.event, request)).toBe('queued')
    const second = fakeEvent(cfEnv)
    expect(await queueEmail(second.event, { ...request, to: ' FernFox@Example.org' })).toBe(
      'not_requested',
    )
    await Promise.all([first.settled(), second.settled()])
    expect(await sends()).toBe(1)
  })

  it('never throws, answers not_requested and logs only a code when set up wrongly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const cloudflareEnv of [
      undefined,
      { DB: db, EMAIL_LOG_HMAC_KEY: key },
      { DB: db, RECEIPTS: kv },
      { DB: db, RECEIPTS: kv, EMAIL_LOG_HMAC_KEY: key, EMAIL_TRANSPORT: 'smtp' },
    ]) {
      const { event, settled } = fakeEvent(cloudflareEnv)
      expect(await queueEmail(event, request)).toBe('not_requested')
      await settled()
    }
    const logged = error.mock.calls.flat().join(' ')
    for (const code of [
      'email_db_missing',
      'email_kv_missing',
      'email_log_hmac_key_missing',
      'email_transport_unknown',
    ]) {
      expect(logged).toContain(code)
    }
    expect(logged).not.toContain('example.org')
    expect(await sends()).toBe(0)
  })

  it('claims nothing on live while only the capture sink exists', async () => {
    const put = vi.spyOn(kv, 'put')
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { event, settled } = fakeEvent({
      DB: db,
      RECEIPTS: kv,
      EMAIL_LOG_HMAC_KEY: key,
      KINMEET_ENV: 'live',
    })
    expect(await queueEmail(event, request)).toBe('not_requested')
    await settled()
    expect(put).not.toHaveBeenCalled()
    expect((await kv.list()).keys).toHaveLength(0)
    expect(await sends()).toBe(0)
    expect(info).not.toHaveBeenCalled()
  })

  it('captures as normal on staging', async () => {
    const { event, settled } = fakeEvent({
      DB: db,
      RECEIPTS: kv,
      EMAIL_LOG_HMAC_KEY: key,
      KINMEET_ENV: 'staging',
    })
    expect(await queueEmail(event, request)).toBe('queued')
    await settled()
    expect(await sends()).toBe(1)
  })

  it('still answers queued when sending fails later, and logs a code', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await db.exec('DROP TABLE email_log')
    const { event, settled } = fakeEvent({ DB: db, RECEIPTS: kv, EMAIL_LOG_HMAC_KEY: key })
    expect(await queueEmail(event, request)).toBe('queued')
    await settled()
    expect(error.mock.calls.flat().join(' ')).toContain('email_send_failed')
  })
})
