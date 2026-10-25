import type { z } from 'zod'
import { toFieldErrors } from '../../../shared/forms/errors'
import { isSameOriginJsonPost, parseJsonObject, readCappedBody } from './request'
import { formResponses, type FormResponse, type Receipt } from './responses'
import type { TurnstileResult } from './turnstile'

/**
 * The steps every form submission goes through, in the contract's fixed
 * order (docs/api/forms.md, "Order of checks"), cheap ones first so garbage
 * never costs a siteverify call:
 *
 * method, origin and content type → size cap → per-network limit → global
 * limit → parse and validate → Turnstile → idempotency lookup → store →
 * receipt limit → queue receipt.
 *
 * Storage, Turnstile, rate limiting and the receipt are passed in, so this
 * runs the same in tests and in the Worker. Errors are logged as a code only,
 * never the request body or anything from it.
 */

export type StoreResult = 'stored' | 'duplicate'

export interface FormSubmissionSteps<Schema extends z.ZodType<{ submissionId: string }>> {
  /** Short form name, also the Turnstile action, for example `hello`. */
  form: string
  schema: Schema
  /** Whether an `Origin` header is this environment's site, from configuration. */
  originAllowed: (origin: string | null) => boolean
  /** Largest body a valid request can have, worked out from the schema. */
  bodyCap: number
  /** What a 201 says when there is no receipt step, and what a repeat says. */
  receipt: Receipt
  /** Per-network limit, then the global limit. */
  withinRateLimit: () => Promise<boolean>
  verifyTurnstile: (token: string) => Promise<TurnstileResult>
  exists: (submissionId: string) => Promise<boolean>
  /** `INSERT … ON CONFLICT DO NOTHING`; `duplicate` when the id was already stored. */
  store: (submission: z.infer<Schema>) => Promise<StoreResult>
  /**
   * After a first successful store only: the receipt limit and queueing the
   * receipt. Returns what the 201 says about the receipt; must not throw.
   */
  afterStore?: (submission: z.infer<Schema>) => Promise<Receipt>
  log: (code: string) => void
}

export async function processFormSubmission<Schema extends z.ZodType<{ submissionId: string }>>(
  request: Request,
  steps: FormSubmissionSteps<Schema>,
): Promise<FormResponse> {
  const { form, log } = steps
  const badRequest = () => {
    log(`${form}_bad_request`)
    return formResponses.badRequest()
  }

  try {
    if (!isSameOriginJsonPost(request, steps.originAllowed)) return badRequest()
    const read = await readCappedBody(request, steps.bodyCap)
    if (!read.ok) return badRequest()

    if (!(await steps.withinRateLimit())) {
      log(`${form}_rate_limited`)
      return formResponses.rateLimited()
    }

    const parsedJson = parseJsonObject(read.text)
    if (!parsedJson.ok) return badRequest()
    const parsed = steps.schema.safeParse(parsedJson.body)
    if (!parsed.success) {
      const mapped = toFieldErrors(parsed.error.issues, parsedJson.body)
      if (!mapped.ok) return badRequest()
      const fieldErrors = mapped.errors.filter((error) => error.field !== 'turnstileToken')
      // A missing or malformed token is a Turnstile failure, so the page
      // resets the widget; other field errors come first.
      if (fieldErrors.length > 0) return formResponses.invalid(fieldErrors)
      return formResponses.turnstileFailed()
    }
    const submission = parsed.data

    const turnstile = await steps.verifyTurnstile(
      (parsedJson.body as { turnstileToken: string }).turnstileToken,
    )
    if (turnstile === 'failed') return formResponses.turnstileFailed()
    if (turnstile === 'unavailable') {
      log(`${form}_turnstile_unavailable`)
      return formResponses.unavailable()
    }

    if (await steps.exists(submission.submissionId)) return formResponses.repeated(steps.receipt)
    if ((await steps.store(submission)) === 'duplicate')
      return formResponses.repeated(steps.receipt)

    const receipt = steps.afterStore ? await steps.afterStore(submission) : steps.receipt
    return formResponses.stored(receipt)
  } catch {
    log(`${form}_unavailable`)
    return formResponses.unavailable()
  }
}
