import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'
import { allowedOrigins, watchPage } from './helpers'

// Firm rule 1: no tracking, analytics or third-party requests on any page.
// The only exception is Cloudflare Turnstile on form pages (S5).
for (const route of publicRoutes) {
  test(`${route.path} makes no third-party requests and no policy violations`, async ({
    page,
    baseURL,
  }) => {
    const problems = await watchPage(
      page,
      allowedOrigins(route, baseURL!),
      new URL(baseURL!).origin,
    )

    const response = await page.goto(route.path, { waitUntil: 'networkidle' })
    expect(response?.status(), 'page should load').toBe(200)

    // Scroll to the end so anything loaded lazily is requested too.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await page.waitForLoadState('networkidle')

    expect.soft(problems.thirdPartyRequests, 'requests to other origins').toEqual([])
    expect.soft(problems.cspViolations, 'content security policy violations').toEqual([])
    expect.soft(problems.pageErrors, 'script errors').toEqual([])
    // Two-sided: form pages load Turnstile (so the widget really appeared)
    // and nothing else; every other page loads nothing from elsewhere.
    expect
      .soft(problems.otherOrigins, 'origins other than our own')
      .toEqual(route.form ? [TURNSTILE_ORIGIN] : [])
  })
}

test('the policy allows Turnstile only on form pages', async ({ request }) => {
  for (const route of publicRoutes) {
    const response = await request.get(route.path)
    const policy = response.headers()['content-security-policy'] ?? ''
    expect(policy, `${route.path} should send a policy`).toContain("default-src 'self'")
    if (route.form) {
      expect(policy).toContain('https://challenges.cloudflare.com')
    } else {
      expect(policy).not.toContain('https://challenges.cloudflare.com')
    }
  }
})
