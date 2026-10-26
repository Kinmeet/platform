import { env } from 'cloudflare:workers'
import type { H3Event } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hmacAddress, inboxAddress } from '../../../../server/email/address-hmac'
import { transportFor } from '../../../../server/email/transport'
import { queueEmail } from '../../../../server/utils/email'
import { clearEmailLog, logRows } from './email-log'

const { DB: db } = env as unknown as { DB: D1Database }
const key = 'test-only-key'
const request = {
  to: 'fernfox@example.org',
  template: 'application_receipt',
  locale: 'en-GB',
} as const
const staging = { DB: db, EMAIL_LOG_HMAC_KEY: key, KINMEET_ENV: 'staging' }

function fakeEvent(cloudflareEnv: Record<string, unknown> | undefined) {
  const pending: Promise<unknown>[] = []
  const event = {
    context: { cloudflare: cloudflareEnv ? { env: cloudflareEnv } : undefined },
    waitUntil: (promise: Promise<unknown>) => pending.push(promise),
  } as unknown as H3Event
  return { event, settled: () => Promise.all(pending) }
}

describe('queueEmail', () => {
  let info: ReturnType<typeof vi.spyOn>
  let warn: ReturnType<typeof vi.spyOn>
  let error: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await clearEmailLog()
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    error = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  it('answers queued, logs the send and sends after the response', async () => {
    const { event, settled } = fakeEvent(staging)
    expect(await queueEmail(event, request)).toBe('queued')
    expect(await logRows()).toHaveLength(1)
    await settled()
    expect(info.mock.calls.flat().join(' ')).toContain('email_captured')
  })

  it('answers not_requested for a second receipt to the same address that day', async () => {
    const first = fakeEvent(staging)
    expect(await queueEmail(first.event, request)).toBe('queued')
    const second = fakeEvent(staging)
    expect(await queueEmail(second.event, { ...request, to: ' FernFox@Example.org' })).toBe(
      'not_requested',
    )
    await Promise.all([first.settled(), second.settled()])
    expect(await logRows()).toHaveLength(1)
    const warned = warn.mock.calls.flat().join(' ')
    expect(warned).toContain('email_rate_limited')
    expect(warned).not.toContain('example.org')
  })

  it('counts sub-addressed and dotted Gmail variants as one inbox', async () => {
    const typed = 'test.person+kinmeet@gmail.com'
    const first = fakeEvent(staging)
    expect(await queueEmail(first.event, { ...request, to: typed })).toBe('queued')
    for (const to of [
      'testperson@gmail.com',
      'test.person+2@googlemail.com',
      'tes.tperson@gmail.com',
    ]) {
      const { event } = fakeEvent(staging)
      expect(await queueEmail(event, { ...request, to })).toBe('not_requested')
    }
    const { event: other } = fakeEvent(staging)
    expect(await queueEmail(other, { ...request, to: 'otherperson@gmail.com' })).toBe('queued')
    const rows = await logRows()
    expect(rows[0]?.to_hmac).toBe(await hmacAddress(key, inboxAddress(typed)))
    await first.settled()
  })

  it('refuses a header-injection address before claiming a receipt', async () => {
    const { event, settled } = fakeEvent(staging)
    expect(
      await queueEmail(event, { ...request, to: 'fernfox@example.org\r\nBcc: x@example.org' }),
    ).toBe('not_requested')
    await settled()
    expect(await logRows()).toHaveLength(0)
  })

  it('never throws, answers not_requested and logs only a code when set up wrongly', async () => {
    for (const cloudflareEnv of [
      undefined,
      { EMAIL_LOG_HMAC_KEY: key, KINMEET_ENV: 'staging' },
      { DB: db, KINMEET_ENV: 'staging' },
      { ...staging, EMAIL_TRANSPORT: 'smtp' },
    ]) {
      const { event, settled } = fakeEvent(cloudflareEnv)
      expect(await queueEmail(event, request)).toBe('not_requested')
      await settled()
    }
    const logged = error.mock.calls.flat().join(' ')
    for (const code of [
      'email_db_missing',
      'email_log_hmac_key_missing',
      'email_transport_unknown',
    ]) {
      expect(logged).toContain(code)
    }
    expect(logged).not.toContain('example.org')
    expect(await logRows()).toHaveLength(0)
  })

  it('claims nothing with only the capture sink on live, or anywhere KINMEET_ENV is missing or unknown', async () => {
    for (const kinmeetEnv of ['live', undefined, '', 'Live', 'production']) {
      const { event, settled } = fakeEvent({
        DB: db,
        EMAIL_LOG_HMAC_KEY: key,
        KINMEET_ENV: kinmeetEnv,
      })
      expect(await queueEmail(event, request)).toBe('not_requested')
      await settled()
    }
    expect(await logRows()).toHaveLength(0)
    expect(info).not.toHaveBeenCalled()
    expect(warn.mock.calls.flat().join(' ')).toContain('email_no_live_transport')
  })

  it('captures on preview and staging', async () => {
    for (const kinmeetEnv of ['preview', 'staging']) {
      await clearEmailLog()
      const { event, settled } = fakeEvent({ ...staging, KINMEET_ENV: kinmeetEnv })
      expect(await queueEmail(event, request)).toBe('queued')
      await settled()
    }
  })

  it('still answers queued when sending fails later, and logs a code', async () => {
    vi.spyOn(transportFor('capture'), 'send').mockRejectedValue(
      new Error('fernfox@example.org refused'),
    )
    const { event, settled } = fakeEvent(staging)
    expect(await queueEmail(event, request)).toBe('queued')
    await settled()
    const logged = error.mock.calls.flat().join(' ')
    expect(logged).toContain('email_send_failed')
    expect(logged).not.toContain('example.org')
  })
})
