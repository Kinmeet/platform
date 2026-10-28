import { FORM_BODY_CAP_MAX } from './forms/body-cap'
import { publishedRoles, type PublishedRole } from './forms/roles'
import { privacyPage } from './pages/privacy'
import { accessibilityPage } from './pages/accessibility'
import { promisePage } from './pages/promise'

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

/** A page that is built before it is published, as in `shared/pages/`. */
export interface DraftablePage {
  path: string
  published: boolean
}

/**
 * Every draftable page, in the order its route is listed. A new one needs its
 * file in `shared/pages/`, plus its import and one line here, and nothing
 * else in this file, so two draft-page PRs no longer conflict (#149). A unit
 * test checks that every page in `shared/pages/` is listed:
 * - the all-ages promise (#77), once its copy is agreed;
 * - the privacy notice (#144) and the accessibility statement (#145), once
 *   the founder's M1 review has agreed them.
 */
export const draftablePages: readonly DraftablePage[] = [
  promisePage,
  privacyPage,
  accessibilityPage,
]

/** What decides which pages are public. Tests pass their own to try a flag. */
export interface PublishedContent {
  roles: readonly PublishedRole[]
  pages: readonly DraftablePage[]
}

export function buildPublicRoutes(content: PublishedContent): PublicRoute[] {
  return [
    { path: '/', form: false },
    // One page per published role (#13), so publishing a role adds its page here.
    ...content.roles.map((role) => ({ path: `/roles/${role.slug}`, form: false })),
    // Say hello (#14): the spam check loads with the page (S5).
    { path: '/say-hello', form: true },
    // Each draftable page, once it's published.
    ...content.pages
      .filter((page) => page.published)
      .map((page) => ({ path: page.path, form: false })),
    // Each role's apply flow (#15): every step is one page, so the policy allows the
    // spam check throughout, but it only loads on step 4.
    ...content.roles.map((role) => ({
      path: `/roles/${role.slug}/apply`,
      form: true,
      focused: true,
      spamCheckOnLoad: false,
    })),
  ]
}

export const publicRoutes: readonly PublicRoute[] = buildPublicRoutes({
  roles: publishedRoles(),
  pages: draftablePages,
})

/**
 * Pages that are built but not published yet. Each answers 404 until its
 * flag is turned on, which moves it into `publicRoutes`. The end-to-end tests
 * check each one is a 404.
 */
export const draftRoutes: readonly string[] = draftablePages
  .filter((page) => !page.published)
  .map((page) => page.path)

/**
 * Pages behind Cloudflare Access (P4), such as the founder's admin page. They
 * are never public, so they can't be loaded like the routes above. Instead,
 * the end-to-end tests check that each one refuses a visitor without an
 * Access token, with the P5 headers and no third-party requests. A page here
 * must not also be in `publicRoutes`.
 */
export const accessRoutes: readonly string[] = ['/admin']

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

/**
 * The largest request body, in bytes, each route accepts. Enforced in front
 * of Nitro (server/entry/body-limit.ts), so a bigger body is refused with 413
 * before anything reads it (issue #54). A form's cap here must be at least
 * its schema's own cap (`bodyCapBytes` in docs/api/forms.md), which the route
 * still checks itself. Publishing refuses a form version whose cap is over
 * its route's limit here (`submitPathFor`), so a valid submission never gets
 * a 413. Apply takes the largest cap any stored form may have; say hello
 * keeps its own, smaller one (Nadia, #158).
 */
export const bodyLimits: Readonly<Record<string, number>> = {
  '/api/hello': 22 * 1024,
  '/api/apply': FORM_BODY_CAP_MAX,
}

/**
 * Where a stored form's submissions are sent. A form with no route of its own
 * gets the small default limit, so publishing refuses it until it has one.
 */
export function submitPathFor(slug: string, kind: 'form' | 'application'): string {
  if (kind === 'application') return '/api/apply'
  return slug === 'hello' ? '/api/hello' : `/api/forms/${slug}`
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
