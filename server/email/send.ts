import type { D1Database } from '@cloudflare/workers-types'
import { hmacAddress } from './address-hmac'
import { countRecentSends, daysBefore, recordSend } from './send-log'
import { renderEmail, type EmailLocale, type EmailTemplateId } from './templates'
import type { EmailTransport } from './transport'

/**
 * At most this many copies of one template go to one address in any 24
 * hours. Turnstile and the per-form limit stop floods; this stops a form
 * being used to fill one stranger's inbox.
 */
export const DAILY_LIMIT_PER_ADDRESS = 3

export interface EmailRequest {
  to: string
  template: EmailTemplateId
  locale: EmailLocale
}

export interface EmailDeps {
  db: D1Database
  hmacKey: string
  transport: EmailTransport
  now?: () => Date
}

export type SendOutcome = 'sent' | 'rate_limited'

export async function sendEmail(deps: EmailDeps, request: EmailRequest): Promise<SendOutcome> {
  const now = deps.now?.() ?? new Date()
  const toHmac = await hmacAddress(deps.hmacKey, request.to)

  const recent = await countRecentSends(deps.db, toHmac, request.template, daysBefore(now, 1))
  if (recent >= DAILY_LIMIT_PER_ADDRESS) return 'rate_limited'

  const rendered = renderEmail(request.template, request.locale)
  await deps.transport.send({ ...rendered, to: request.to.trim(), template: request.template })
  await recordSend(deps.db, toHmac, request.template, now)
  return 'sent'
}

/** Error codes only: never the address, the message or the error's own text. */
export function emailErrorCode(error: unknown): string {
  if (error instanceof Error && /^email_[a-z_]+$/.test(error.message)) return error.message
  return 'email_send_failed'
}
