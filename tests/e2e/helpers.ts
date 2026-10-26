import type { Page } from '@playwright/test'
import type { PublicRoute } from '../../shared/routes'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'

/** Origins a page may load from, besides its own (S5: Turnstile on form pages only). */
export function allowedOrigins(route: PublicRoute, baseURL: string): Set<string> {
  const origins = new Set([new URL(baseURL).origin])
  if (route.form) origins.add(TURNSTILE_ORIGIN)
  return origins
}

export interface PageProblems {
  thirdPartyRequests: string[]
  cspViolations: string[]
  pageErrors: string[]
  /** Every origin other than the page's own that was requested, allowed or not. */
  otherOrigins: string[]
}

/**
 * Records every request to another origin and every content security policy
 * violation while a page loads. Requests to other origins are blocked as well
 * as recorded, so a failing test never reaches a third party.
 */
export async function watchPage(
  page: Page,
  allowed: Set<string>,
  ownOrigin: string,
): Promise<PageProblems> {
  const problems: PageProblems = {
    thirdPartyRequests: [],
    cspViolations: [],
    pageErrors: [],
    otherOrigins: [],
  }

  await page.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.protocol === 'data:' || url.protocol === 'blob:' || allowed.has(url.origin)) {
      return route.continue()
    }
    problems.thirdPartyRequests.push(url.href)
    return route.abort('blockedbyclient')
  })

  // Some requests (service workers, beacons) can bypass routing, so also
  // check every request the page makes.
  page.on('request', (request) => {
    const url = new URL(request.url())
    const isOther = url.protocol !== 'data:' && url.protocol !== 'blob:' && url.origin !== ownOrigin
    if (isOther && !problems.otherOrigins.includes(url.origin))
      problems.otherOrigins.push(url.origin)
    if (url.protocol === 'data:' || url.protocol === 'blob:' || allowed.has(url.origin)) return
    if (!problems.thirdPartyRequests.includes(url.href)) problems.thirdPartyRequests.push(url.href)
  })

  page.on('console', (message) => {
    if (/content security policy/i.test(message.text())) {
      problems.cspViolations.push(message.text())
    }
  })

  page.on('pageerror', (error) => problems.pageErrors.push(error.message))

  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} blocked ${event.blockedURI || 'inline'}`,
      )
    })
  })

  return problems
}
