import type { H3Event } from 'h3'
import { getRequestHeader, toWebRequest } from 'h3'
import type { z } from 'zod'
import { processFormSubmission, type FormSubmissionSteps } from './process'
import { withinRateLimit, type RateLimiter } from './rate-limit'
import { sendFormResponse } from './responses'
import { verifyTurnstile } from './turnstile'

/**
 * Worker bindings and secrets the form routes use. Secrets are set per
 * environment with `wrangler secret put`; limiters are in `wrangler.jsonc`.
 */
export interface FormEnv {
  TURNSTILE_SECRET_KEY: string
  RATE_LIMIT_HMAC_KEY: string
  FORM_RATE_LIMITER: RateLimiter
  FORM_GLOBAL_RATE_LIMITER: RateLimiter
}

export function formEnv(event: H3Event): FormEnv {
  const env = (event.context as { cloudflare?: { env?: Partial<FormEnv> } }).cloudflare?.env
  if (
    !env?.TURNSTILE_SECRET_KEY ||
    !env.RATE_LIMIT_HMAC_KEY ||
    !env.FORM_RATE_LIMITER ||
    !env.FORM_GLOBAL_RATE_LIMITER
  ) {
    throw new Error('form_env_missing')
  }
  return env as FormEnv
}

/** Logs a code only: never the request, its body, headers or anything typed. */
export function logFormCode(code: string) {
  console.error(JSON.stringify({ code }))
}

type RouteSteps<Schema extends z.ZodType<{ submissionId: string }>> = Pick<
  FormSubmissionSteps<Schema>,
  'form' | 'schema' | 'receipt'
> & {
  exists: (event: H3Event, submissionId: string) => Promise<boolean>
  store: (
    event: H3Event,
    submission: z.infer<Schema>,
  ) => ReturnType<FormSubmissionSteps<Schema>['store']>
  afterStore?: (event: H3Event, submission: z.infer<Schema>) => Promise<void>
}

/**
 * Handles one form submission from start to finish. The route supplies the
 * schema and storage; everything else (origin, size, rate limit, Turnstile,
 * validation, idempotency, response shapes) is shared.
 */
export async function handleFormSubmission<Schema extends z.ZodType<{ submissionId: string }>>(
  event: H3Event,
  route: RouteSteps<Schema>,
) {
  let env: FormEnv
  try {
    env = formEnv(event)
  } catch {
    logFormCode(`${route.form}_env_missing`)
    return sendFormResponse(event, { status: 503, body: { ok: false, error: 'unavailable' } })
  }

  const request = toWebRequest(event)
  const { afterStore } = route
  const response = await processFormSubmission(request, {
    form: route.form,
    schema: route.schema,
    receipt: route.receipt,
    withinRateLimit: () =>
      withinRateLimit({
        form: route.form,
        // Used only to build the HMAC key; never stored or logged.
        ip: getRequestHeader(event, 'CF-Connecting-IP') ?? null,
        hmacKey: env.RATE_LIMIT_HMAC_KEY,
        perConnection: env.FORM_RATE_LIMITER,
        global: env.FORM_GLOBAL_RATE_LIMITER,
      }),
    verifyTurnstile: (token) =>
      verifyTurnstile({
        secret: env.TURNSTILE_SECRET_KEY,
        token,
        expectedHostname: new URL(request.url).hostname,
      }),
    exists: (submissionId) => route.exists(event, submissionId),
    store: (submission) => route.store(event, submission),
    afterStore: afterStore ? (submission) => afterStore(event, submission) : undefined,
    log: logFormCode,
  })
  return sendFormResponse(event, response)
}
