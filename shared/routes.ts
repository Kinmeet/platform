/**
 * Every public route in the app, in one place.
 *
 * The no-third-party-requests test loads each of these, and the security
 * headers use `form` to decide whether Cloudflare Turnstile may load. Every
 * new page must be added here, or the route coverage test fails.
 */
export interface PublicRoute {
  path: string
  /** True only for pages that show a form protected by Turnstile (S5). */
  form: boolean
}

export const publicRoutes: readonly PublicRoute[] = [{ path: '/', form: false }]

/**
 * Pages behind Cloudflare Access (the founder's admin page). They are never
 * public: without a valid Access token they must refuse, and the end-to-end
 * tests check that they do, with the same security headers as every page.
 * A page here must not also be in `publicRoutes`.
 */
export const adminRoutes: readonly string[] = []

export function isFormRoute(path: string, routes: readonly PublicRoute[] = publicRoutes): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  return routes.some((route) => route.form && route.path === clean)
}
