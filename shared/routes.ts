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

export function isFormRoute(path: string, routes: readonly PublicRoute[] = publicRoutes): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  return routes.some((route) => route.form && route.path === clean)
}

/**
 * True when moving between these paths goes onto or off a form page. The
 * security policy is set once per document from the first path loaded, so
 * such a move must load a new document to get the right policy (#20, P5).
 */
export function crossesFormBoundary(
  to: string,
  from: string,
  routes: readonly PublicRoute[] = publicRoutes,
): boolean {
  return isFormRoute(to, routes) !== isFormRoute(from, routes)
}
