import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'
import { allowedOrigins, watchPage } from './helpers'
import { watchOwnRequests, watchRealTurnstile } from './turnstile'

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

    // Always the real widget here, never the stand-in (#148). We wait for our
    // own requests rather than `networkidle`, which Turnstile's challenge can
    // hold off for good under load.
    const spamCheck = route.form && route.spamCheckOnLoad !== false
    const own = watchOwnRequests(page, new URL(baseURL!).origin)
    const turnstile = spamCheck ? watchRealTurnstile(page) : undefined
    const response = await page.goto(route.path)
    expect(response?.status(), 'page should load').toBe(200)
    await turnstile?.loaded()
    await own.settled()

    // Scroll to the end so anything loaded lazily is requested too.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await own.settled()

    expect.soft(problems.thirdPartyRequests, 'requests to other origins').toEqual([])
    expect.soft(problems.cspViolations, 'content security policy violations').toEqual([])
    expect.soft(problems.pageErrors, 'script errors').toEqual([])
    // Two-sided: form pages load Turnstile (so the widget really appeared)
    // and nothing else; every other page loads nothing from elsewhere. A form
    // whose spam check is on a later step loads nothing yet; its own spec
    // checks the later step (apply.spec.ts, #81).
    expect
      .soft(problems.otherOrigins, 'origins other than our own')
      .toEqual(spamCheck ? [TURNSTILE_ORIGIN] : [])
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

// The dev-only policy (#70) relaxes styles and allows ws: for Vite. It must
// never reach a built Worker.
test('the built Worker never sends the dev policy', async ({ request }) => {
  for (const route of publicRoutes) {
    const policy = (await request.get(route.path)).headers()['content-security-policy'] ?? ''
    expect(policy, route.path).not.toContain("'unsafe-inline'")
    expect(policy, route.path).not.toContain('ws:')
  }
})
