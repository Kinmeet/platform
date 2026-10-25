import type { EmailTemplateId, RenderedEmail } from './templates'

export interface EmailMessage extends RenderedEmail {
  to: string
  template: EmailTemplateId
}

export interface EmailTransport {
  readonly name: string
  send(message: EmailMessage): Promise<void>
}

/** How many captured messages one Worker isolate keeps in memory. */
export const CAPTURE_LIMIT = 20

/**
 * Keeps messages in this isolate's memory instead of sending them. Used on
 * staging and in tests until Kinmeet has a domain with SPF, DKIM and DMARC
 * (S3, P1 Phase 0), so nothing leaves the platform. Nothing is written to
 * storage, and the log line names the template only. Never used on live.
 *
 * `captured` is for tests only and must never be served by any route. A
 * staging viewer for captured mail would need its own privacy review.
 */
export function createCaptureTransport(limit = CAPTURE_LIMIT) {
  const captured: EmailMessage[] = []
  return {
    name: 'capture',
    captured: captured as readonly EmailMessage[],
    async send(message: EmailMessage) {
      captured.push(message)
      if (captured.length > limit) captured.splice(0, captured.length - limit)
      console.info(JSON.stringify({ event: 'email_captured', template: message.template }))
    },
    clear() {
      captured.length = 0
    },
  } satisfies EmailTransport & { captured: readonly EmailMessage[]; clear(): void }
}

const captureTransport = createCaptureTransport()

/**
 * Picks the transport named by `EMAIL_TRANSPORT`. Only `capture` exists
 * until a Kinmeet domain is registered; the Cloudflare Email Service
 * transport is added with the domain (ADR-0006). An unknown name fails
 * loudly rather than silently dropping mail.
 */
export function transportFor(name: string | undefined): EmailTransport {
  switch (name ?? 'capture') {
    case 'capture':
      return captureTransport
    default:
      throw new Error('email_transport_unknown')
  }
}
