import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import { recordSend } from './send-log'
import { renderEmail, type EmailLocale, type EmailTemplateId } from './templates'
import type { EmailTransport } from './transport'

/**
 * One receipt per address per day (Security Reviewer, contract b9f2115).
 * Turnstile and the per-form limit stop floods; this stops a form being
 * used to fill one stranger's inbox.
 */
export const RECEIPT_MARKER_TTL_SECONDS = 24 * 60 * 60

export interface EmailRequest {
  to: string
  template: EmailTemplateId
  locale: EmailLocale
}

export function receiptMarkerKey(toHmac: string): string {
  return `receipt:${toHmac}`
}

/**
 * Claims today's receipt for an address. The KV marker's key holds only the
 * address HMAC and it expires by itself after 24 hours. Returns false when a
 * receipt has already gone to this address in that time. KV is eventually
 * consistent, so two submissions in the same moment may both get one; the
 * limit is about inbox abuse, not exact counting.
 */
export async function claimReceipt(kv: KVNamespace, toHmac: string): Promise<boolean> {
  const key = receiptMarkerKey(toHmac)
  if ((await kv.get(key)) !== null) return false
  await kv.put(key, '1', { expirationTtl: RECEIPT_MARKER_TTL_SECONDS })
  return true
}

export interface DeliverDeps {
  db: D1Database
  transport: EmailTransport
  now?: () => Date
}

/** Renders the fixed template, sends it, then writes the send log row. */
export async function deliverEmail(
  deps: DeliverDeps,
  request: EmailRequest,
  toHmac: string,
): Promise<void> {
  const rendered = renderEmail(request.template, request.locale)
  await deps.transport.send({ ...rendered, to: request.to.trim(), template: request.template })
  await recordSend(deps.db, toHmac, request.template, deps.now?.() ?? new Date())
}

/** Error codes only: never the address, the message or the error's own text. */
export function emailErrorCode(error: unknown): string {
  if (error instanceof Error && /^email_[a-z_]+$/.test(error.message)) return error.message
  return 'email_send_failed'
}
