import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hmacAddress } from '../../../../server/email/address-hmac'
import {
  RECEIPT_MARKER_TTL_SECONDS,
  claimReceipt,
  deliverEmail,
  emailErrorCode,
  receiptMarkerKey,
} from '../../../../server/email/send'
import { SEND_LOG_RETENTION_DAYS } from '../../../../server/email/send-log'
import { createCaptureTransport, transportFor } from '../../../../server/email/transport'
import { createEmailLog } from './email-log'

const { DB: db, KV: kv } = env as unknown as { DB: D1Database; KV: KVNamespace }
const hmacKey = 'test-only-key-not-a-secret'
const address = 'fernfox@example.org'

async function logRows() {
  const { results } = await db.prepare('SELECT * FROM email_log').all<Record<string, string>>()
  return results
}

describe('deliverEmail', () => {
  const now = new Date('2026-11-02T10:00:00.000Z')
  let transport: ReturnType<typeof createCaptureTransport>
  let info: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    await createEmailLog()
    transport = createCaptureTransport()
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  const deps = () => ({ db, transport, now: () => now })
  const request = { to: address, template: 'application_receipt', locale: 'en-GB' } as const

  it('sends the fixed receipt to the address given', async () => {
    await deliverEmail(deps(), request, await hmacAddress(hmacKey, address))
    expect(transport.captured).toHaveLength(1)
    expect(transport.captured[0]).toMatchObject({ to: address, template: 'application_receipt' })
  })

  it('logs only an HMAC of the address, the template and dates, kept 30 days', async () => {
    const toHmac = await hmacAddress(hmacKey, '  FernFox@Example.Org ')
    await deliverEmail(deps(), { ...request, to: '  FernFox@Example.Org ' }, toHmac)
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

  it('writes no log row when the transport fails', async () => {
    const failing = { name: 'failing', send: () => Promise.reject(new Error('boom')) }
    await expect(
      deliverEmail({ ...deps(), transport: failing }, request, 'a'.repeat(64)),
    ).rejects.toThrow()
    expect(await logRows()).toHaveLength(0)
  })

  it('logs the template id when capturing, never the address or text', async () => {
    await deliverEmail(deps(), request, 'a'.repeat(64))
    const logged = info.mock.calls.flat().join(' ')
    expect(logged).toContain('application_receipt')
    expect(logged).not.toContain('example.org')
    expect(logged).not.toContain('received your application')
  })
})

describe('claimReceipt', () => {
  it('allows one receipt per address, with a marker that expires after a day', async () => {
    const toHmac = await hmacAddress(hmacKey, 'oakmoth@example.org')
    const put = vi.spyOn(kv, 'put')
    expect(await claimReceipt(kv, toHmac)).toBe(true)
    expect(await claimReceipt(kv, toHmac)).toBe(false)
    expect(await claimReceipt(kv, await hmacAddress(hmacKey, 'OAKMOTH@example.org '))).toBe(false)
    expect(await claimReceipt(kv, await hmacAddress(hmacKey, 'birchwren@example.org'))).toBe(true)
    expect(put).toHaveBeenCalledWith(receiptMarkerKey(toHmac), '1', {
      expirationTtl: RECEIPT_MARKER_TTL_SECONDS,
    })
    expect(RECEIPT_MARKER_TTL_SECONDS).toBe(86_400)
    vi.restoreAllMocks()
  })

  it('keys the marker on the HMAC only', async () => {
    const toHmac = await hmacAddress(hmacKey, 'ashfinch@example.org')
    await claimReceipt(kv, toHmac)
    const { keys } = await kv.list({ prefix: 'receipt:' })
    expect(keys.map((k) => k.name)).toContain(`receipt:${toHmac}`)
    expect(keys.some((k) => k.name.includes('example.org'))).toBe(false)
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
    vi.restoreAllMocks()
  })

  it('gives the same HMAC whatever the case or spacing, and a different one per key', async () => {
    const a = await hmacAddress(hmacKey, address)
    expect(await hmacAddress(hmacKey, ' FERNFOX@example.ORG')).toBe(a)
    expect(await hmacAddress('another-test-key', address)).not.toBe(a)
  })

  it('refuses to hash without a key', async () => {
    await expect(hmacAddress('', address)).rejects.toThrow('email_log_hmac_key_missing')
  })
})
