/**
 * Matching a request's origin, or a Turnstile token's hostname, against this
 * environment's configured `SITE_ORIGIN` (docs/api/forms.md, "Same origin
 * only"; docs/environments.md).
 *
 * Staging and live are exact. Previews have no fixed host, so their
 * `SITE_ORIGIN` is a pattern such as
 * `https://*-kinmeet-staging.kinmeet.workers.dev`, where `*` stands for
 * exactly one DNS label (the preview name). The pattern is honoured only when
 * `KINMEET_ENV` is `preview`; anywhere else a `*` matches nothing.
 */

// One DNS label: letters, digits and inner hyphens, 1 to 63 characters.
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ORIGIN = /^(https?):\/\/([^/?#\s]+)$/

export interface SitePattern {
  /** `SITE_ORIGIN` for this environment. */
  siteOrigin: string
  /** `KINMEET_ENV` for this environment. */
  environment: string | undefined
}

/**
 * Hostnames Cloudflare's dummy test keys can report from siteverify
 * (developers.cloudflare.com/turnstile/troubleshooting/testing). Accepted only
 * when `KINMEET_ENV` is `local`, never on staging, Previews or live.
 */
export const TURNSTILE_TEST_HOSTNAMES: readonly string[] = ['localhost', 'example.com']

function hostMatches(host: string, patternHost: string, allowWildcard: boolean): boolean {
  if (!patternHost.includes('*')) return host === patternHost
  if (!allowWildcard) return false
  // Only a single leading `*` is supported, standing for one whole label.
  if (!patternHost.startsWith('*') || patternHost.indexOf('*', 1) !== -1) return false
  const suffix = patternHost.slice(1)
  if (suffix === '' || !host.endsWith(suffix)) return false
  return DNS_LABEL.test(host.slice(0, host.length - suffix.length))
}

function splitOrigin(origin: string): { scheme: string; host: string } | null {
  const match = ORIGIN.exec(origin)
  return match ? { scheme: match[1]!, host: match[2]! } : null
}

/** True when `origin` (an `Origin` header) is this environment's site. */
export function originAllowed(
  origin: string | null,
  { siteOrigin, environment }: SitePattern,
): boolean {
  if (origin === null || origin === 'null') return false
  const actual = splitOrigin(origin)
  const expected = splitOrigin(siteOrigin)
  if (actual === null || expected === null || actual.scheme !== expected.scheme) return false
  return hostMatches(actual.host, expected.host, environment === 'preview')
}

/** True when `hostname` (from siteverify) belongs to this environment's site. */
export function hostnameAllowed(
  hostname: string,
  { siteOrigin, environment }: SitePattern,
): boolean {
  if (environment === 'local' && TURNSTILE_TEST_HOSTNAMES.includes(hostname)) return true
  const expected = splitOrigin(siteOrigin)
  if (expected === null) return false
  // siteverify reports a hostname without a port.
  const expectedHost = expected.host.replace(/:\d+$/, '')
  return hostMatches(hostname, expectedHost, environment === 'preview')
}
