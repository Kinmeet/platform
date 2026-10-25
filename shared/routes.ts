/**
 * Every public route in the app, in one place.
 *
 * The no-third-party-requests test loads each of these, and the security
 * headers use `form` to decide whether Cloudflare Turnstile may load. A new
 * page must be added here, or the route coverage test fails.
 */
export interface PublicRoute {
  path: string
  /** True only for pages that show a form protected by Turnstile (S5). */
  form: boolean
}

export const publicRoutes: readonly PublicRoute[] = [{ path: '/', form: false }]

export function isFormRoute(path: string): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  return publicRoutes.some((route) => route.form && route.path === clean)
}
