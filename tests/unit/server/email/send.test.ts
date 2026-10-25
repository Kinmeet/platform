import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hmacAddress } from '../../../../server/email/address-hmac'
import { DAILY_LIMIT_PER_ADDRESS, emailErrorCode, sendEmail } from '../../../../server/email/send'
import { SEND_LOG_RETENTION_DAYS } from '../../../../server/email/send-log'
import { createCaptureTransport, transportFor } from '../../../../server/email/transport'

const db = (env as unknown as { DB: D1Database }).DB
const hmacKey = 'test-only-key-not-a-secret'
const address = 'fernfox@example.org'

// The agreed email_log shape. The migration itself belongs to #27; once it
// lands, this setup applies the real migrations instead.
async function createEmailLog() {
  await db.exec('DROP TABLE IF EXISTS email_log')
  await db.exec(
    'CREATE TABLE email_log (id TEXT PRIMARY KEY, to_hmac TEXT NOT NULL, template_id TEXT NOT NULL, sent_at TEXT NOT NULL, delete_after TEXT NOT NULL)',
  )
}

async function logRows() {
  const { results } = await db.prepare('SELECT * FROM email_log').all<Record<string, string>>()
  return results
}

describe('sendEmail', () => {
  const now = new Date('2026-11-02T10:00:00.000Z')
  let transport: ReturnType<typeof createCaptureTransport>

  beforeEach(async () => {
    await createEmailLog()
    transport = createCaptureTransport()
  })

  afterEach(() => vi.restoreAllMocks())

  const deps = () => ({ db, hmacKey, transport, now: () => now })
  const request = { to: address, template: 'application_receipt', locale: 'en-GB' } as const

  it('sends the fixed receipt to the address given', async () => {
    expect(await sendEmail(deps(), request)).toBe('sent')
    expect(transport.captured).toHaveLength(1)
    expect(transport.captured[0]).toMatchObject({ to: address, template: 'application_receipt' })
  })

  it('logs only an HMAC of the address, the template and dates, kept 30 days', async () => {
    await sendEmail(deps(), { ...request, to: '  FernFox@Example.Org ' })
    const rows = await logRows()
    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(Object.keys(row).sort()).toEqual([
      'delete_after',
      'id',
      'sent_at',
      'template_id',
      'to_hmac',
    ])
    expect(row.to_hmac).toBe(await hmacAddress(hmacKey, address))
    expect(row.to_hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row).toLowerCase()).not.toContain('fernfox')
    expect(row.template_id).toBe('application_receipt')
    expect(row.sent_at).toBe(now.toISOString())
    const days = (Date.parse(row.delete_after!) - now.getTime()) / 86_400_000
    expect(days).toBe(SEND_LOG_RETENTION_DAYS)
  })

  it('stops after the daily limit for one address, and counts other addresses separately', async () => {
    for (let i = 0; i < DAILY_LIMIT_PER_ADDRESS; i++) {
      expect(await sendEmail(deps(), request)).toBe('sent')
    }
    expect(await sendEmail(deps(), request)).toBe('rate_limited')
    expect(await sendEmail(deps(), { ...request, to: 'FERNFOX@example.org' })).toBe('rate_limited')
    expect(await sendEmail(deps(), { ...request, to: 'oakmoth@example.org' })).toBe('sent')
    expect(transport.captured).toHaveLength(DAILY_LIMIT_PER_ADDRESS + 1)
  })

  it('allows the address again once a day has passed', async () => {
    for (let i = 0; i < DAILY_LIMIT_PER_ADDRESS; i++) await sendEmail(deps(), request)
    const later = new Date(now.getTime() + 86_400_001)
    expect(await sendEmail({ ...deps(), now: () => later }, request)).toBe('sent')
  })

  it('writes no log row when the transport fails', async () => {
    const failing = { name: 'failing', send: () => Promise.reject(new Error('boom')) }
    await expect(sendEmail({ ...deps(), transport: failing }, request)).rejects.toThrow()
    expect(await logRows()).toHaveLength(0)
  })

  it('refuses to run without the HMAC key', async () => {
    await expect(sendEmail({ ...deps(), hmacKey: '' }, request)).rejects.toThrow(
      'email_log_hmac_key_missing',
    )
  })

  it('logs the template id when capturing, never the address or text', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    await sendEmail(deps(), request)
    const logged = info.mock.calls.flat().join(' ')
    expect(logged).toContain('application_receipt')
    expect(logged).not.toContain('example.org')
    expect(logged).not.toContain('received your application')
  })
})

describe('email helpers', () => {
  it('turns any error into a code without its message', () => {
    expect(emailErrorCode(new Error('email_db_missing'))).toBe('email_db_missing')
    expect(emailErrorCode(new Error('fernfox@example.org bounced'))).toBe('email_send_failed')
    expect(emailErrorCode('anything')).toBe('email_send_failed')
  })

  it('uses the capture transport by default and refuses unknown ones', () => {
    expect(transportFor(undefined).name).toBe('capture')
    expect(transportFor('capture').name).toBe('capture')
    expect(() => transportFor('smtp')).toThrow('email_transport_unknown')
  })

  it('keeps only the most recent captured messages', async () => {
    const transport = createCaptureTransport(2)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    for (const to of ['a@example.org', 'b@example.org', 'c@example.org']) {
      await transport.send({ to, template: 'application_receipt', subject: '', text: '', html: '' })
    }
    expect(transport.captured.map((m) => m.to)).toEqual(['b@example.org', 'c@example.org'])
  })

  it('gives the same HMAC whatever the case or spacing, and a different one per key', async () => {
    const a = await hmacAddress(hmacKey, address)
    expect(await hmacAddress(hmacKey, ' FERNFOX@example.ORG')).toBe(a)
    expect(await hmacAddress('another-test-key', address)).not.toBe(a)
  })
})
