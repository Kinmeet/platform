import type { H3Event } from 'h3'
import { getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import { originAllowed } from '../forms/site-origin'
import { verifyAccessToken, type AccessIdentity } from './access'

/** Paths behind Cloudflare Access: the admin page and its API. */
export function isAdminPath(path: string): boolean {
  const clean = path.split('?')[0] ?? ''
  return /^\/(api\/)?admin(\/|$)/.test(clean)
}

interface AdminEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  SITE_ORIGIN?: string
  KINMEET_ENV?: string
}

function adminEnv(event: H3Event): AdminEnv {
  return (event.context as { cloudflare?: { env?: AdminEnv } }).cloudflare?.env ?? {}
}

export function forbidden(event: H3Event) {
  setResponseStatus(event, 403)
  return { ok: false, error: 'forbidden' }
}

/**
 * Checks the Access token on an admin request and keeps the identity on the
 * event. Returns `null` when the request may go on, or the refusal to send.
 * Fails closed: no configuration, no token or an unreachable key set all
 * refuse.
 */
export async function guardAdminRequest(event: H3Event, fetcher: typeof fetch = fetch) {
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  const env = adminEnv(event)
  let identity: AccessIdentity | null = null
  try {
    identity = await verifyAccessToken(
      getRequestHeader(event, 'Cf-Access-Jwt-Assertion'),
      { teamDomain: env.ACCESS_TEAM_DOMAIN ?? '', audience: env.ACCESS_AUD ?? '' },
      { fetcher },
    )
  } catch {
    console.error(JSON.stringify({ code: 'admin_access_keys_unavailable' }))
  }
  if (identity === null) return forbidden(event)

  // Actions change data, so they must also come from our own admin page.
  if (event.method !== 'GET' && event.method !== 'HEAD') {
    const site = { siteOrigin: env.SITE_ORIGIN ?? '', environment: env.KINMEET_ENV }
    if (!env.SITE_ORIGIN || !originAllowed(getRequestHeader(event, 'Origin') ?? null, site)) {
      return forbidden(event)
    }
  }

  event.context.adminIdentity = identity
  return null
}

/** The verified identity set by the admin middleware. */
export function adminIdentity(event: H3Event): AccessIdentity {
  const identity = event.context.adminIdentity as AccessIdentity | undefined
  if (!identity) throw new Error('admin_identity_missing')
  return identity
}
