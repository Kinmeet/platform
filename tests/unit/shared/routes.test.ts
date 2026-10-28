import { describe, expect, it } from 'vitest'
import { publishedRoles } from '../../../shared/forms/roles'
import { promisePage } from '../../../shared/pages/promise'
import {
  accessRoutes,
  buildPublicRoutes,
  crossesFormBoundary,
  draftRoutes,
  publicRoutes,
} from '../../../shared/routes'
import { hasPage } from '../../../shared/site-nav'

// Every page must be listed in shared/routes.ts, as a public route (loaded
// by the no-third-party and accessibility tests), an Access route (checked
// to refuse without an Access token) or a draft route (checked to be a 404). The glob is resolved when the test is
// built, so this works inside workerd without file system access.
const pageFiles = Object.keys(import.meta.glob('../../../app/pages/**/*.vue'))
const listedPaths = [...publicRoutes.map((route) => route.path), ...accessRoutes, ...draftRoutes]

/** Turns a page file name into its route pattern, e.g. groups/[slug].vue → /groups/:slug */
function routePattern(file: string): string {
  const path = file
    .replace(/^.*\/app\/pages/, '')
    .replace(/\.vue$/, '')
    .replace(/\/index$/, '')
    .replace(/\[\.\.\.[^\]]+\]/g, '*')
    .replace(/\[\[?([^\]]+)\]?\]/g, ':$1')
  return path || '/'
}

function matches(pattern: string, path: string): boolean {
  const source = pattern
    .split('/')
    .map((part) => {
      if (part === '*') return '.+'
      if (part.startsWith(':')) return '[^/]+'
      return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  return new RegExp(`^${source}$`).test(path)
}

describe('route list', () => {
  it('finds the page files', () => {
    expect(pageFiles.length).toBeGreaterThan(0)
  })

  it('turns page file names into route patterns', () => {
    expect(routePattern('../../../app/pages/index.vue')).toBe('/')
    expect(routePattern('../../../app/pages/about.vue')).toBe('/about')
    expect(routePattern('../../../app/pages/groups/index.vue')).toBe('/groups')
    expect(routePattern('../../../app/pages/groups/[slug].vue')).toBe('/groups/:slug')
    expect(routePattern('../../../app/pages/[...path].vue')).toBe('/*')
  })

  it('lists every page in shared/routes.ts', () => {
    const missing = pageFiles
      .map(routePattern)
      .filter((pattern) => !listedPaths.some((path) => matches(pattern, path)))
    expect(missing, 'add these pages to shared/routes.ts').toEqual([])
  })

  it('has a page for every listed route', () => {
    const patterns = pageFiles.map(routePattern)
    const stale = listedPaths.filter((path) => !patterns.some((pattern) => matches(pattern, path)))
    expect(stale, 'remove these routes or add their pages').toEqual([])
  })

  it('lists each route once, and never as more than one of public, Access and draft', () => {
    expect(new Set(listedPaths).size).toBe(listedPaths.length)
  })
  // The no-third-party test doesn't check Turnstile on arrival for these
  // routes, so each one needs a spec that reaches its spam check step and
  // asserts Turnstile loads there (Nadia, #81; Kit, #85). Today that's only
  // the apply flow, covered by tests/e2e/apply.spec.ts. A new route here
  // fails this test until its spec exists and the list below is updated.
  it('waits to load the spam check only on routes with a spec for the later step', () => {
    const later = publicRoutes
      .filter((route) => route.spamCheckOnLoad === false)
      .map((route) => route.path)
    expect(later).toEqual(publishedRoles().map((role) => `/roles/${role.slug}/apply`))
  })

  it('waits to load the spam check only on form routes', () => {
    const notForms = publicRoutes.filter((route) => route.spamCheckOnLoad === false && !route.form)
    expect(notForms).toEqual([])
  })
})

// The all-ages promise (#77) is built but not published until its copy is
// agreed. Publishing it is one flag, and these show what that flag does.
describe('all-ages promise page', () => {
  it('is a draft while unpublished, so its links stay hidden', () => {
    expect(promisePage.published).toBe(false)
    expect(draftRoutes).toContain(promisePage.path)
    expect(hasPage(promisePage.path)).toBe(false)
  })

  it('becomes a public route once published, so the end-to-end checks load it', () => {
    const routes = buildPublicRoutes({ roles: publishedRoles(), promise: true })
    expect(routes).toContainEqual({ path: promisePage.path, form: false })
    expect(hasPage(promisePage.path, routes)).toBe(true)
  })

  it('keeps every other route the same either way', () => {
    const published = buildPublicRoutes({ roles: publishedRoles(), promise: true })
    expect(published.filter((route) => route.path !== promisePage.path)).toEqual(
      buildPublicRoutes({ roles: publishedRoles(), promise: false }),
    )
  })
})

describe('form page boundary', () => {
  // Made-up routes, so this holds whatever the real list contains.
  const routes = [
    { path: '/', form: false },
    { path: '/about', form: false },
    { path: '/write-to-us', form: true },
    { path: '/apply-here', form: true },
  ]

  it('needs a new document going onto or off a form page', () => {
    expect(crossesFormBoundary('/write-to-us', '/', routes)).toBe(true)
    expect(crossesFormBoundary('/', '/write-to-us', routes)).toBe(true)
    expect(crossesFormBoundary('/write-to-us/', '/about', routes)).toBe(true)
  })

  it('keeps in-app navigation between pages of the same kind', () => {
    expect(crossesFormBoundary('/about', '/', routes)).toBe(false)
    expect(crossesFormBoundary('/apply-here', '/write-to-us', routes)).toBe(false)
    expect(crossesFormBoundary('/write-to-us?step=2', '/write-to-us', routes)).toBe(false)
  })
})
