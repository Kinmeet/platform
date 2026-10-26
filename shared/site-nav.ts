import { publicRoutes, type PublicRoute } from './routes'

/**
 * Links in the site header and footer (#11). Wording lives in
 * `i18n/locales/` under `site.nav.<id>`.
 *
 * A link to a page that isn't built yet is left out until its route is
 * listed in `shared/routes.ts`, so the shell never shows a dead link (W10).
 */
export interface NavLink {
  id: string
  path: string
  /** A section on the page, without the `#`. */
  hash?: string
}

/** Header links, in order. Say hello is shown as a button. */
export const mainNav: readonly NavLink[] = [
  { id: 'roles', path: '/', hash: 'roles' },
  { id: 'say_hello', path: '/say-hello' },
]

/** Footer links, in order. */
export const footerNav: readonly NavLink[] = [
  { id: 'roles', path: '/', hash: 'roles' },
  { id: 'say_hello', path: '/say-hello' },
  { id: 'promise', path: '/all-ages-promise' },
  { id: 'data', path: '/how-we-handle-data' },
]

/** The links whose pages exist. */
export function liveLinks(
  links: readonly NavLink[],
  routes: readonly PublicRoute[] = publicRoutes,
): NavLink[] {
  return links.filter((link) => routes.some((route) => route.path === link.path))
}

/** The `href` for a link. */
export function linkHref(link: NavLink): string {
  return link.hash ? `${link.path}#${link.hash}` : link.path
}
