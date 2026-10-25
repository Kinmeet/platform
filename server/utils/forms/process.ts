import type { z } from 'zod'
import { toFieldErrors } from '../../../shared/forms/errors'
import { isSameOriginJsonPost, readCappedJson } from './request'
import { formResponses, type FormResponse, type Receipt } from './responses'
import type { TurnstileResult } from './turnstile'

/**
 * The steps every form submission goes through, in the order the contract
 * sets (docs/api/forms.md):
 *
 * 1. Same origin JSON POST, rate limit, then the body (16 KB cap).
 * 2. Turnstile, before anything else is looked at or stored.
 * 3. Validation with the form's shared schema.
 * 4. A repeated `submissionId` returns the first result and stores nothing.
 * 5. Store, then any after-store work (the receipt email) on the first 201 only.
 *
 * Storage, Turnstile and rate limiting are passed in, so this runs the same
 * in tests and in the Worker. Errors are logged as a code only, never the
 * request body or anything from it.
 */

export type StoreResult = 'stored' | 'duplicate'

export interface FormSubmissionSteps<Schema extends z.ZodType<{ submissionId: string }>> {
  /** Short form name used in rate limit keys and log codes, for example `hello`. */
  form: string
  schema: Schema
  /** What the 201 (and any repeat) says about a receipt email. */
  receipt: Receipt
  withinRateLimit: () => Promise<boolean>
  verifyTurnstile: (token: string) => Promise<TurnstileResult>
  exists: (submissionId: string) => Promise<boolean>
  /** Returns `duplicate` when a concurrent request stored the same id first. */
  store: (submission: z.infer<Schema>) => Promise<StoreResult>
  /** Runs after a first successful store only; must not throw (see queueEmail). */
  afterStore?: (submission: z.infer<Schema>) => Promise<void>
  log: (code: string) => void
}

export async function processFormSubmission<Schema extends z.ZodType<{ submissionId: string }>>(
  request: Request,
  steps: FormSubmissionSteps<Schema>,
): Promise<FormResponse> {
  const { form, log } = steps
  try {
    // The cheap shape check comes before the limiter, so requests that were
    // never from our page do not use up our own visitors' allowance.
    if (!isSameOriginJsonPost(request)) {
      log(`${form}_bad_request`)
      return formResponses.badRequest()
    }
    if (!(await steps.withinRateLimit())) {
      log(`${form}_rate_limited`)
      return formResponses.rateLimited()
    }
    const checked = await readCappedJson(request)
    if (!checked.ok) {
      log(`${form}_bad_request`)
      return formResponses.badRequest()
    }

    const token = (checked.body as { turnstileToken?: unknown }).turnstileToken
    if (typeof token !== 'string' || token.length === 0) return formResponses.turnstileFailed()
    const turnstile = await steps.verifyTurnstile(token)
    if (turnstile === 'failed') return formResponses.turnstileFailed()
    if (turnstile === 'unavailable') {
      log(`${form}_turnstile_unavailable`)
      return formResponses.unavailable()
    }

    const parsed = steps.schema.safeParse(checked.body)
    if (!parsed.success) {
      const mapped = toFieldErrors(parsed.error.issues, checked.body)
      if (!mapped.ok) {
        log(`${form}_bad_request`)
        return formResponses.badRequest()
      }
      return formResponses.invalid(mapped.errors)
    }
    const submission = parsed.data

    if (await steps.exists(submission.submissionId)) return formResponses.repeated(steps.receipt)
    if ((await steps.store(submission)) === 'duplicate')
      return formResponses.repeated(steps.receipt)

    await steps.afterStore?.(submission)
    return formResponses.stored(steps.receipt)
  } catch {
    log(`${form}_unavailable`)
    return formResponses.unavailable()
  }
}
