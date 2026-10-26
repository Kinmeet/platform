import { assertSendableAddress } from './address-hmac'
import { renderEmail, type EmailLocale, type EmailTemplateId } from './templates'
import type { EmailTransport } from './transport'

export interface EmailRequest {
  to: string
  template: EmailTemplateId
  locale: EmailLocale
}

/** Renders the fixed template and sends it to the address exactly as given. */
export async function deliverEmail(
  transport: EmailTransport,
  request: EmailRequest,
): Promise<void> {
  assertSendableAddress(request.to)
  const rendered = renderEmail(request.template, request.locale)
  await transport.send({ ...rendered, to: request.to.trim(), template: request.template })
}

/** Error codes only: never the address, the message or the error's own text. */
export function emailErrorCode(error: unknown): string {
  if (error instanceof Error && /^email_[a-z_]+$/.test(error.message)) return error.message
  return 'email_send_failed'
}
