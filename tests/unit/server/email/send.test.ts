import { env } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertSendableAddress,
  hmacAddress,
  inboxAddress,
} from '../../../../server/email/address-hmac'
import { deliverEmail, emailErrorCode } from '../../../../server/email/send'
import { RECEIPT_WINDOW_SECONDS, claimSend } from '../../../../server/email/send-log'
import { createCaptureTransport, transportFor } from '../../../../server/email/transport'
import { EMAIL_LOG_RETENTION_DAYS, emailLogDeleteAfter } from '../../../../server/utils/retention'
import { clearEmailLog, logRows } from './email-log'

const { DB: db } = env as unknown as { DB: D1Database }
const hmacKey = 'test-only-key-not-a-secret'
const address = 'fernfox@example.org'
const request = { to: address, template: 'application_receipt', locale: 'en-GB' } as const

afterEach(() => vi.restoreAllMocks())

describe('deliverEmail', () => {
  let transport: ReturnType<typeof createCaptureTransport>
  let info: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    transport = createCaptureTransport()
    info = vi.spyOn(console, 'info').mockImplementation(() => {})
  })

  it('sends the fixed receipt to the address exactly as given', async () => {
    await deliverEmail(transport, { ...request, to: 'Fern.Fox+kinmeet@example.org' })
    expect(transport.captured).toHaveLength(1)
    expect(transport.captured[0]).toMatchObject({
      to: 'Fern.Fox+kinmeet@example.org',
      template: 'application_receipt',
    })
  })

  it('refuses addresses that could add a mail header, and sends nothing', async () => {
    for (const to of [
      'fernfox@example.org\r\nBcc: oakmoth@example.org',
      'fernfox@example.org\nX-Test: 1',
      'fern\u0000fox@example.org',
      'fernfox@example.org@example.org',
      'fernfox.example.org',
    ]) {
      await expect(deliverEmail(transport, { ...request, to })).rejects.toThrow(
        'email_invalid_address',
      )
    }
    expect(transport.captured).toHaveLength(0)
  })

  it('logs the template id when capturing, never the address or text', async () => {
    await deliverEmail(transport, request)
    const logged = info.mock.calls.flat().join(' ')
    expect(logged).toContain('application_receipt')
    expect(logged).not.toContain('example.org')
    expect(logged).not.toContain('received your application')
  })
})

describe('claimSend', () => {
  const now = new Date('2026-11-02T10:00:00.000Z')
  const nowSeconds = Math.floor(now.getTime() / 1000)
  let toHmac: string

  beforeEach(async () => {
    await clearEmailLog()
    toHmac = await hmacAddress(hmacKey, inboxAddress(address))
  })

  it('writes a row holding only the HMAC, the template and dates, kept 30 days', async () => {
    expect(await claimSend(db, toHmac, 'application_receipt', now)).toBe(true)
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
    expect(row.to_hmac).toBe(toHmac)
    expect(row.to_hmac).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(row).toLowerCase()).not.toContain('fernfox')
    expect(row.template_id).toBe('application_receipt')
    expect(row.sent_at).toBe(nowSeconds)
    expect(row.delete_after - row.sent_at).toBe(EMAIL_LOG_RETENTION_DAYS * 86_400)
  })

  it('takes its deletion date from the shared retention rules', async () => {
    await claimSend(db, toHmac, 'application_receipt', now)
    const row = (await logRows())[0]!
    expect(row.delete_after).toBe(emailLogDeleteAfter(row.sent_at))
    expect(EMAIL_LOG_RETENTION_DAYS).toBe(30)
  })

  it('allows one per inbox in 24 hours, counting other inboxes separately', async () => {
    expect(await claimSend(db, toHmac, 'application_receipt', now)).toBe(true)
    expect(await claimSend(db, toHmac, 'application_receipt', now)).toBe(false)
    const later = new Date(now.getTime() + (RECEIPT_WINDOW_SECONDS - 1) * 1000)
    expect(await claimSend(db, toHmac, 'application_receipt', later)).toBe(false)
    const other = await hmacAddress(hmacKey, 'oakmoth@example.org')
    expect(await claimSend(db, other, 'application_receipt', now)).toBe(true)
    expect(await logRows()).toHaveLength(2)
  })

  it('allows the inbox again once 24 hours have passed', async () => {
    await claimSend(db, toHmac, 'application_receipt', now)
    const nextDay = new Date(now.getTime() + RECEIPT_WINDOW_SECONDS * 1000)
    expect(await claimSend(db, toHmac, 'application_receipt', nextDay)).toBe(true)
  })

  it('lets only one of two claims at the same moment through', async () => {
    const results = await Promise.all([
      claimSend(db, toHmac, 'application_receipt', now),
      claimSend(db, toHmac, 'application_receipt', now),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await logRows()).toHaveLength(1)
  })
})

describe('inboxAddress', () => {
  it('drops a +tag for every domain', () => {
    expect(inboxAddress('FernFox+1@Example.org ')).toBe('fernfox@example.org')
    expect(inboxAddress('fernfox+a+b@example.org')).toBe('fernfox@example.org')
    expect(inboxAddress('fern.fox+x@example.org')).toBe('fern.fox@example.org')
  })

  it('removes dots and joins the two Gmail domains', () => {
    for (const variant of [
      'test.person@gmail.com',
      'testperson+2@gmail.com',
      't.e.s.t.person@googlemail.com',
      'TestPerson@GMAIL.com',
    ]) {
      expect(inboxAddress(variant)).toBe('testperson@gmail.com')
    }
  })

  it('leaves anything without a local part alone', () => {
    expect(inboxAddress('+tag@example.org')).toBe('+tag@example.org')
    expect(inboxAddress('not-an-address')).toBe('not-an-address')
  })

  it('accepts an ordinary address', () => {
    expect(() => assertSendableAddress('fernfox+tag@example.org')).not.toThrow()
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

  it('keeps only the most recent captured messages in a test transport', async () => {
    const transport = createCaptureTransport(2)
    vi.spyOn(console, 'info').mockImplementation(() => {})
    for (const to of ['a@example.org', 'b@example.org', 'c@example.org']) {
      await transport.send({ to, template: 'application_receipt', subject: '', text: '', html: '' })
    }
    expect(transport.captured.map((m) => m.to)).toEqual(['b@example.org', 'c@example.org'])
  })

  it('keeps nothing in the deployed capture transport', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const deployed = transportFor('capture') as ReturnType<typeof createCaptureTransport>
    await deployed.send({ ...request, subject: '', text: '', html: '' })
    expect(deployed.captured).toHaveLength(0)
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
