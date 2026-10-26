import { setResponseHeader, setResponseStatus, type H3Event } from 'h3'
import type { FieldError } from '../../../shared/forms/errors'
import { RATE_LIMIT_PERIOD_SECONDS } from './rate-limit'

/**
 * The response shapes from docs/api/forms.md. Every form route answers with
 * one of these and nothing else.
 */

export type Receipt = 'queued' | 'not_requested'

export type FormResponse =
  | { status: 200 | 201; body: { ok: true; receipt: Receipt } }
  | { status: 422 | 403; body: { ok: false; errors: FieldError[] } }
  | { status: 400; body: { ok: false; error: 'bad_request' } }
  | { status: 429; body: { ok: false; error: 'rate_limited'; retryAfter: number } }
  | { status: 503; body: { ok: false; error: 'unavailable' } }

export const formResponses = {
  stored: (receipt: Receipt): FormResponse => ({ status: 201, body: { ok: true, receipt } }),
  repeated: (receipt: Receipt): FormResponse => ({ status: 200, body: { ok: true, receipt } }),
  invalid: (errors: FieldError[]): FormResponse => ({ status: 422, body: { ok: false, errors } }),
  turnstileFailed: (): FormResponse => ({
    status: 403,
    body: { ok: false, errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }] },
  }),
  badRequest: (): FormResponse => ({ status: 400, body: { ok: false, error: 'bad_request' } }),
  rateLimited: (): FormResponse => ({
    status: 429,
    body: { ok: false, error: 'rate_limited', retryAfter: RATE_LIMIT_PERIOD_SECONDS },
  }),
  unavailable: (): FormResponse => ({ status: 503, body: { ok: false, error: 'unavailable' } }),
}

/** Writes a form response with headers that stop it being cached. */
export function sendFormResponse(event: H3Event, response: FormResponse) {
  setResponseStatus(event, response.status)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  if (response.status === 429) setResponseHeader(event, 'Retry-After', response.body.retryAfter)
  return response.body
}
