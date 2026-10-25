import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { emailErrorCode, sendEmail, type EmailRequest } from '../email/send'
import { transportFor } from '../email/transport'

interface EmailEnv {
  DB: D1Database
  EMAIL_LOG_HMAC_KEY: string
  EMAIL_TRANSPORT?: string
}

/**
 * Queues one fixed-template email after the response is sent. Call it only
 * once a submission is stored for the first time. It never throws and never
 * delays the response: a failed or rate-limited email never turns a stored
 * submission into a failure (docs/api/forms.md), so callers always answer
 * `receipt: "queued"`. Failures log an error code only.
 */
export function queueEmail(event: H3Event, request: EmailRequest): void {
  const work = (async () => {
    try {
      const env = event.context.cloudflare?.env as EmailEnv | undefined
      if (!env?.DB) throw new Error('email_db_missing')
      const outcome = await sendEmail(
        {
          db: env.DB,
          hmacKey: env.EMAIL_LOG_HMAC_KEY,
          transport: transportFor(env.EMAIL_TRANSPORT),
        },
        request,
      )
      if (outcome === 'rate_limited') {
        console.warn(JSON.stringify({ event: 'email_rate_limited', template: request.template }))
      }
    } catch (error) {
      console.error(JSON.stringify({ event: emailErrorCode(error), template: request.template }))
    }
  })()
  event.waitUntil(work)
}
