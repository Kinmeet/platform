/**
 * Server-side Cloudflare Turnstile verification (S5).
 *
 * Sends only the secret and the token, never the optional `remoteip`, so no
 * IP address leaves the Worker. Checks `success`, the hostname and the action,
 * and fails closed: if siteverify cannot be reached, nothing is stored. The
 * token is single-use and is not kept.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
const TIMEOUT_MS = 5000

/** `passed`: verified. `failed`: Turnstile said no. `unavailable`: we could not ask. */
export type TurnstileResult = 'passed' | 'failed' | 'unavailable'

interface SiteverifyResponse {
  success?: unknown
  hostname?: unknown
  action?: unknown
}

export interface VerifyTurnstileOptions {
  secret: string
  token: string
  /** The token must have been issued on this environment's hostname. */
  expectedHostname: string
  /** The widget's `data-action`, which is the form name, so a token cannot cross forms. */
  expectedAction: string
  fetcher?: typeof fetch
}

export async function verifyTurnstile({
  secret,
  token,
  expectedHostname,
  expectedAction,
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
  if (data.hostname !== expectedHostname || data.action !== expectedAction) return 'failed'
  return 'passed'
}
