import type { D1Database, KVNamespace } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { assertSendableAddress, hmacAddress, inboxAddress } from '../email/address-hmac'
import { claimReceipt, deliverEmail, emailErrorCode, type EmailRequest } from '../email/send'
import { transportFor } from '../email/transport'

interface EmailEnv {
  DB: D1Database
  /** Receipt-limit markers, in their own namespace (#39). */
  RECEIPTS: KVNamespace
  EMAIL_LOG_HMAC_KEY: string
  EMAIL_TRANSPORT?: string
  /** `staging`, `preview` or `live` (#39). */
  KINMEET_ENV?: string
}

export type ReceiptStatus = 'queued' | 'not_requested'

/**
 * Queues one fixed-template email. Call it only once a submission is stored
 * for the first time, and answer with the status it returns as `receipt`.
 *
 * It checks the one-per-address-per-day limit before returning, then sends
 * after the response in `waitUntil`. It never throws: a limited, failed or
 * misconfigured email never turns a stored submission into a failure
 * (docs/api/forms.md). Over the limit, or when the email cannot be set up,
 * it returns `not_requested`. Failures log an error code only.
 */
export async function queueEmail(event: H3Event, request: EmailRequest): Promise<ReceiptStatus> {
  try {
    const env = event.context.cloudflare?.env as EmailEnv | undefined
    if (!env?.DB) throw new Error('email_db_missing')
    if (!env.RECEIPTS) throw new Error('email_kv_missing')
    const transport = transportFor(env.EMAIL_TRANSPORT)
    // Live has no real transport until Kinmeet has a domain. Saying a receipt
    // is on its way would not be true (P9), so nothing is claimed, logged or
    // captured there (Privacy and Safeguarding Reviewer).
    if (transport.name === 'capture' && env.KINMEET_ENV === 'live') {
      console.warn(JSON.stringify({ event: 'email_no_live_transport', template: request.template }))
      return 'not_requested'
    }
    assertSendableAddress(request.to)
    // The log keeps the address as typed, so "did my email arrive?" matches;
    // the limit counts per inbox.
    const toHmac = await hmacAddress(env.EMAIL_LOG_HMAC_KEY, request.to)
    const inboxHmac = await hmacAddress(env.EMAIL_LOG_HMAC_KEY, inboxAddress(request.to))

    if (!(await claimReceipt(env.RECEIPTS, inboxHmac))) {
      console.warn(JSON.stringify({ event: 'email_rate_limited', template: request.template }))
      return 'not_requested'
    }

    event.waitUntil(
      deliverEmail({ db: env.DB, transport }, request, toHmac).catch((error: unknown) => {
        console.error(JSON.stringify({ event: emailErrorCode(error), template: request.template }))
      }),
    )
    return 'queued'
  } catch (error) {
    console.error(JSON.stringify({ event: emailErrorCode(error), template: request.template }))
    return 'not_requested'
  }
}
