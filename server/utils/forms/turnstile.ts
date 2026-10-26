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
  /** The token must have been issued on this environment's site (see `site-origin.ts`). */
  hostnameAllowed: (hostname: string) => boolean
  /** The widget's `data-action`, which is the form name, so a token cannot cross forms. */
  expectedAction: string
  /**
   * Local development only: also accept the `test` action that Cloudflare's
   * dummy test keys report. Never set on staging, Previews or live.
   */
  acceptTestAction?: boolean
  fetcher?: typeof fetch
}

/** The action Cloudflare's dummy test keys report from siteverify. */
export const TURNSTILE_TEST_ACTION = 'test'

export async function verifyTurnstile({
  secret,
  token,
  hostnameAllowed,
  expectedAction,
  acceptTestAction = false,
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
  if (typeof data.hostname !== 'string' || !hostnameAllowed(data.hostname)) return 'failed'
  const actionOk =
    data.action === expectedAction || (acceptTestAction && data.action === TURNSTILE_TEST_ACTION)
  if (!actionOk) return 'failed'
  return 'passed'
}
