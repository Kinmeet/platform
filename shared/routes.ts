import { publishedRoles } from './forms/roles'

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

export const publicRoutes: readonly PublicRoute[] = [
  { path: '/', form: false },
  // One page per published role (#13), so publishing a role adds its page here.
  ...publishedRoles().map((role) => ({ path: `/roles/${role.slug}`, form: false })),
]

export function isFormRoute(path: string, routes: readonly PublicRoute[] = publicRoutes): boolean {
  const clean = path.split('?')[0]?.replace(/\/+$/, '') || '/'
  return routes.some((route) => route.form && route.path === clean)
}
