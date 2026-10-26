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
  /** The focused layout (the apply flow): no main nav and no footer. */
  focused?: boolean
  /**
   * False when the spam check only appears on a later step, so the page
   * contacts Cloudflare only once it's needed (apply step 4, Callum, #81).
   * Form pages load it straight away otherwise. Any route that sets this
   * must have a spec that reaches its spam-check step and asserts Turnstile
   * loads there, as `tests/e2e/apply.spec.ts` does, because the
   * no-third-party test no longer checks it on arrival (Nadia, #81).
   */
  spamCheckOnLoad?: boolean
}

export const publicRoutes: readonly PublicRoute[] = [
  { path: '/', form: false },
  // One page per published role (#13), so publishing a role adds its page here.
  ...publishedRoles().map((role) => ({ path: `/roles/${role.slug}`, form: false })),
  // Its apply flow (#15): every step is one page, so the policy allows the
  // spam check throughout, but it only loads on step 4.
  ...publishedRoles().map((role) => ({
    path: `/roles/${role.slug}/apply`,
    form: true,
    focused: true,
    spamCheckOnLoad: false,
  })),
]

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
