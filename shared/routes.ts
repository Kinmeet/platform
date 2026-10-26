/**
 * Every public route in the app, in one place.
 *
 * The no-third-party-requests test loads each of these, and the security
 * headers use `form` to decide whether Cloudflare Turnstile may load. Every
 * new page must be added here; a route coverage test for this arrives with
 * issue #6.
 */
export interface PublicRoute {
  path: string
  /** True only for pages that show a form protected by Turnstile (S5). */
  form: boolean
}

export const publicRoutes: readonly PublicRoute[] = [{ path: '/', form: false }]

export function isFormRoute(path: string, routes: readonly PublicRoute[] = publicRoutes): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  return routes.some((route) => route.form && route.path === clean)
}

/**
 * The largest request body, in bytes, each route accepts. Enforced in front
 * of Nitro (server/entry/body-limit.ts), so a bigger body is refused with 413
 * before anything reads it (issue #54). A form's cap here must be at least
 * its schema's own cap (`bodyCapBytes` in docs/api/forms.md), which the route
 * still checks itself.
 */
export const bodyLimits: Readonly<Record<string, number>> = {
  '/api/hello': 22 * 1024,
  '/api/apply': 64 * 1024,
}

/** Any other route: no body on GET and HEAD, and only a small one otherwise. */
export const DEFAULT_BODY_LIMIT = 1024

export function bodyLimitFor(
  method: string,
  path: string,
  limits: Readonly<Record<string, number>> = bodyLimits,
): number {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  const limit = limits[clean]
  if (limit !== undefined) return limit
  return method === 'GET' || method === 'HEAD' ? 0 : DEFAULT_BODY_LIMIT
}
