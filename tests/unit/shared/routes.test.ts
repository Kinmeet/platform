import { describe, expect, it } from 'vitest'
import { adminRoutes, publicRoutes } from '../../../shared/routes'

// Every page must be listed in shared/routes.ts, as a public route (loaded
// by the no-third-party and accessibility tests) or an admin route (checked
// to refuse without an Access token). The glob is resolved when the test is built,
// so this works inside workerd without file system access.
const pageFiles = Object.keys(import.meta.glob('../../../app/pages/**/*.vue'))
const listedPaths = [...publicRoutes.map((route) => route.path), ...adminRoutes]

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

  it('lists each route once, and never as both public and admin', () => {
    expect(new Set(listedPaths).size).toBe(listedPaths.length)
  })
})
