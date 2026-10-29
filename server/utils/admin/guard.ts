import type { H3Event } from 'h3'
import { getRequestHeader, setResponseHeader, setResponseStatus } from 'h3'
import { originAllowed } from '../forms/site-origin'
import { verifyAccessClaims, type AccessClaims, type AccessIdentity } from './access'

/** Paths behind Cloudflare Access: the admin page and its API. */
export function isAdminPath(path: string): boolean {
  const clean = path.split('?')[0] ?? ''
  return /^\/(api\/)?admin(\/|$)/.test(clean)
}

/**
 * The publish page and the publish API, which sit behind their own Access
 * application with a short session and MFA on every sign-in (Nadia, #160;
 * ADR-0010). Their tokens are that application's, not the main admin one's.
 */
export function isPublishPath(path: string): boolean {
  const clean = path.split('?')[0] ?? ''
  // The page's own requests (such as its payload) sit under its path, and
  // Access sends them the publish application's token too (Nadia, #170).
  return (
    /^\/api\/admin\/forms\/[^/]+\/publish\/?$/.test(clean) ||
    /^\/admin\/forms\/[^/]+\/publish(\/|$)/.test(clean)
  )
}

/** How long ago the publish application's token may have been issued. */
export const PUBLISH_MAX_AGE_SECONDS = 5 * 60
/** The longest a publish token may be valid for, so the session stays short. */
export const PUBLISH_MAX_LIFETIME_SECONDS = 10 * 60

interface AdminEnv {
  ACCESS_TEAM_DOMAIN?: string
  ACCESS_AUD?: string
  /** The publish Access application's audience tag. Without it, publishing is off. */
  ACCESS_PUBLISH_AUD?: string
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

/** The person must sign in to the publish application again, with MFA. */
export function reauthRequired(event: H3Event) {
  setResponseStatus(event, 403)
  return { ok: false, error: 'reauth_required' }
}

/** This environment has no publish application yet, so nothing can publish. */
function publishingOff(event: H3Event) {
  setResponseStatus(event, 403)
  return { ok: false, error: 'publishing_off' }
}

/** Whether a publish token is fresh and short-lived (ADR-0010, Nadia's conditions). */
export function isFreshPublishToken(claims: AccessClaims, now = Math.floor(Date.now() / 1000)) {
  return (
    claims.iat !== null &&
    claims.iat <= now + 60 &&
    now - claims.iat <= PUBLISH_MAX_AGE_SECONDS &&
    claims.exp - claims.iat <= PUBLISH_MAX_LIFETIME_SECONDS
  )
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
  const token = getRequestHeader(event, 'Cf-Access-Jwt-Assertion')
  const teamDomain = env.ACCESS_TEAM_DOMAIN ?? ''
  const verify = (audience: string) =>
    verifyAccessClaims(token, { teamDomain, audience }, { fetcher })
  let identity: AccessIdentity | null = null
  try {
    if (isPublishPath(event.path)) {
      // Only a fresh token from the publish application will do. A valid
      // main admin token, or a stale publish one, means the person has to
      // sign in again with MFA; anything else is refused as usual.
      if (!env.ACCESS_PUBLISH_AUD) return publishingOff(event)
      const publish = await verify(env.ACCESS_PUBLISH_AUD)
      if (publish === null || !isFreshPublishToken(publish)) {
        const main = publish === null ? await verify(env.ACCESS_AUD ?? '') : null
        return publish === null && main === null ? forbidden(event) : reauthRequired(event)
      }
      identity = { sub: publish.sub }
      event.context.publishRechecked = true
    } else {
      const claims = await verify(env.ACCESS_AUD ?? '')
      identity = claims === null ? null : { sub: claims.sub }
    }
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

/**
 * Whether the admin middleware ran the publish re-check on this request. The
 * publish route asks too, so a path the pattern somehow missed can never
 * publish on a main admin token (Theo, #163).
 */
export function publishRechecked(event: H3Event): boolean {
  return event.context.publishRechecked === true
}

/** The verified identity set by the admin middleware. */
export function adminIdentity(event: H3Event): AccessIdentity {
  const identity = event.context.adminIdentity as AccessIdentity | undefined
  if (!identity) throw new Error('admin_identity_missing')
  return identity
}
