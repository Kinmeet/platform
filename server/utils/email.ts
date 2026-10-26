import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { assertSendableAddress, hmacAddress, inboxAddress } from '../email/address-hmac'
import { deliverEmail, emailErrorCode, type EmailRequest } from '../email/send'
import { claimSend } from '../email/send-log'
import { transportFor } from '../email/transport'

interface EmailEnv {
  DB: D1Database
  EMAIL_LOG_HMAC_KEY: string
  EMAIL_TRANSPORT?: string
  /** `local`, `preview`, `staging` or `live` (docs/environments.md). */
  KINMEET_ENV?: string
}

export type ReceiptStatus = 'queued' | 'not_requested'

/**
 * Where the capture sink may stand in for real sending. Anywhere else,
 * including a Worker where `KINMEET_ENV` is missing or misspelt, is treated
 * as live: saying a receipt is on its way would not be true (P9), so nothing
 * is claimed, logged or captured (Privacy and Safeguarding Reviewer; fail
 * closed, Services EM).
 */
const captureEnvironments = new Set(['local', 'test', 'preview', 'staging'])

function log(level: 'warn' | 'error', event: string, request: EmailRequest) {
  console[level](JSON.stringify({ event, template: request.template }))
}

/**
 * Queues one fixed-template email. Call it only once a submission is stored
 * for the first time, and answer with the status it returns as `receipt`.
 *
 * Before returning it checks the address, claims the day's receipt for that
 * inbox and writes the send log row; the email itself is sent after the
 * response in `waitUntil`. It never throws: a limited, failed or
 * misconfigured email never turns a stored submission into a failure
 * (docs/api/forms.md). Over the limit, or when email is not set up, it
 * returns `not_requested`. Failures log an error code only.
 */
export async function queueEmail(event: H3Event, request: EmailRequest): Promise<ReceiptStatus> {
  try {
    const env = event.context.cloudflare?.env as EmailEnv | undefined
    if (!env?.DB) throw new Error('email_db_missing')
    const transport = transportFor(env.EMAIL_TRANSPORT)
    if (transport.name === 'capture' && !captureEnvironments.has(env.KINMEET_ENV ?? '')) {
      log('warn', 'email_no_live_transport', request)
      return 'not_requested'
    }
    assertSendableAddress(request.to)
    const toHmac = await hmacAddress(env.EMAIL_LOG_HMAC_KEY, inboxAddress(request.to))

    if (!(await claimSend(env.DB, toHmac, request.template, new Date()))) {
      log('warn', 'email_rate_limited', request)
      return 'not_requested'
    }

    event.waitUntil(
      deliverEmail(transport, request).catch((error: unknown) => {
        log('error', emailErrorCode(error), request)
      }),
    )
    return 'queued'
  } catch (error) {
    log('error', emailErrorCode(error), request)
    return 'not_requested'
  }
}
