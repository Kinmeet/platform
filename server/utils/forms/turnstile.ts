/**
 * Server-side Cloudflare Turnstile verification (S5).
 *
 * Sends only the secret and the token, never the optional `remoteip`, so no
 * IP address leaves the Worker. The token is single-use and is not kept.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 5000

/** `passed`: verified. `failed`: Turnstile said no. `unavailable`: we could not ask. */
export type TurnstileResult = 'passed' | 'failed' | 'unavailable'

interface SiteverifyResponse {
  success?: unknown
  hostname?: unknown
}

export interface VerifyTurnstileOptions {
  secret: string
  token: string
  /** When set, the token must have been issued on this hostname. */
  expectedHostname?: string
  fetcher?: typeof fetch
}

export async function verifyTurnstile({
  secret,
  token,
  expectedHostname,
  fetcher = fetch,
}: VerifyTurnstileOptions): Promise<TurnstileResult> {
  if (!secret) return 'unavailable'
  if (!token) return 'failed'

  const form = new FormData()
  form.append('secret', secret)
  form.append('response', token)

  let data: SiteverifyResponse
  try {
    const response = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) return 'unavailable'
    data = (await response.json()) as SiteverifyResponse
  } catch {
    return 'unavailable'
  }

  if (data.success !== true) return 'failed'
  if (expectedHostname !== undefined && data.hostname !== expectedHostname) return 'failed'
  return 'passed'
}
