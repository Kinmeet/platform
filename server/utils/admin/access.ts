/**
 * Verifying Cloudflare Access on the admin page and API (#32, P4, P5).
 *
 * Access sits in front of `/admin` on the deployed Workers and lets only the
 * founder through. The Worker does not trust that alone: every admin request
 * must carry a valid Access token (`Cf-Access-Jwt-Assertion`), signed by the
 * team's keys, for this application's audience, and not expired. Anything
 * else is refused, including a missing configuration (fail closed).
 */

export interface AccessConfig {
  /** The Access team domain, for example `example.cloudflareaccess.com`. */
  teamDomain: string
  /** The Access application's audience tag. */
  audience: string
}

export interface AccessIdentity {
  /** Access's opaque user id. Used in the audit log; never an email address. */
  sub: string
}

/** A valid token's identity and the times the publish re-check needs. */
export interface AccessClaims extends AccessIdentity {
  /** When Access issued the token, if it says. */
  iat: number | null
  exp: number
}

interface Jwk extends JsonWebKey {
  kid?: string
}

const CLOCK_SKEW_SECONDS = 60
const KEYS_TTL_MS = 10 * 60 * 1000
// An unknown kid forces a fresh fetch at most once a minute, so tokens with
// made-up kids cannot make every request fetch the keys again.
const KEYS_REFRESH_MIN_MS = 60 * 1000
const keyCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>()

function base64UrlDecode(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(part)))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

async function teamKeys(
  teamDomain: string,
  fetcher: typeof fetch,
  refresh: boolean,
): Promise<Jwk[]> {
  const cached = keyCache.get(teamDomain)
  const age = cached ? Date.now() - cached.fetchedAt : Infinity
  if (cached && age < (refresh ? KEYS_REFRESH_MIN_MS : KEYS_TTL_MS)) return cached.keys
  const response = await fetcher(`https://${teamDomain}/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error('access_keys_unavailable')
  const body = (await response.json()) as { keys?: unknown }
  const keys = Array.isArray(body.keys) ? (body.keys as Jwk[]) : []
  keyCache.set(teamDomain, { keys, fetchedAt: Date.now() })
  return keys
}

/** Clears cached keys (tests only). */
export function clearAccessKeyCache() {
  keyCache.clear()
}

/**
 * Returns the identity in a valid Access token, or `null` for anything else.
 * Throws only when the team's keys cannot be fetched.
 */
export async function verifyAccessToken(
  token: string | null | undefined,
  config: AccessConfig,
  options: { fetcher?: typeof fetch; now?: number } = {},
): Promise<AccessIdentity | null> {
  const claims = await verifyAccessClaims(token, config, options)
  return claims === null ? null : { sub: claims.sub }
}

/** As `verifyAccessToken`, with the token's issue and expiry times as well. */
export async function verifyAccessClaims(
  token: string | null | undefined,
  config: AccessConfig,
  {
    fetcher = fetch,
    now = Math.floor(Date.now() / 1000),
  }: { fetcher?: typeof fetch; now?: number } = {},
): Promise<AccessClaims | null> {
  if (!token || !config.teamDomain || !config.audience) return null
  if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(config.teamDomain)) return null

  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string]
  const header = decodeJson(headerPart)
  const payload = decodeJson(payloadPart)
  if (!header || !payload || header.alg !== 'RS256' || typeof header.kid !== 'string') return null

  let keys = await teamKeys(config.teamDomain, fetcher, false)
  let jwk = keys.find((key) => key.kid === header.kid)
  if (!jwk) {
    // Access rotates keys; look again once before refusing.
    keys = await teamKeys(config.teamDomain, fetcher, true)
    jwk = keys.find((key) => key.kid === header.kid)
  }
  if (!jwk || jwk.kty !== 'RSA') return null

  let valid: boolean
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    valid = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      base64UrlDecode(signaturePart),
      new TextEncoder().encode(`${headerPart}.${payloadPart}`),
    )
  } catch {
    return null
  }
  if (!valid) return null

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(config.audience)) return null
  if (payload.iss !== `https://${config.teamDomain}`) return null
  if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_SECONDS < now) return null
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) return null
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128)
    return null
  return {
    sub: payload.sub,
    iat: typeof payload.iat === 'number' ? payload.iat : null,
    exp: payload.exp,
  }
}
