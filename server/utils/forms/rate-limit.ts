import { hmacHex } from './hmac'

/**
 * Rate limiting with Cloudflare's rate limiting binding
 * (docs/api/forms.md, "Rate limiting").
 *
 * The per-connection key is `${form}:${hmac(ip)}`: the raw IP address is never
 * used as a key, stored or logged, and the counts live only inside
 * Cloudflare. A global per-form limiter is the flood backstop. Turnstile stays
 * the main defence, so the per-connection limit is generous.
 */

/** The binding's `limit()` call, so tests can supply a fake. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface RateLimitOptions {
  form: string
  ip: string | null
  hmacKey: string
  perConnection: RateLimiter
  global: RateLimiter
}

/** Matches the limiters' period in `wrangler.jsonc`. */
export const RATE_LIMIT_PERIOD_SECONDS = 60

/** True when the request may go ahead. */
export async function withinRateLimit({
  form,
  ip,
  hmacKey,
  perConnection,
  global,
}: RateLimitOptions): Promise<boolean> {
  const globalResult = await global.limit({ key: form })
  if (!globalResult.success) return false
  // Without an address (only in local tests) the global limiter still applies.
  if (!ip) return true
  const key = `${form}:${await hmacHex(hmacKey, ip)}`
  const result = await perConnection.limit({ key })
  return result.success
}
