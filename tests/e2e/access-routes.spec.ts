import { expect, test } from '@playwright/test'
import { accessRoutes } from '../../shared/routes'
import { watchPage } from './helpers'

// Pages behind Cloudflare Access are never public. Without an Access token,
// each one must refuse, still send the P5 headers, and load nothing from
// another origin (firm rule 1).
for (const path of accessRoutes) {
  test(`${path} refuses without Access, with the security headers`, async ({ request }) => {
    const response = await request.get(path)
    expect(response.status()).toBe(403)
    const headers = response.headers()
    expect(headers['content-security-policy']).toContain("default-src 'self'")
    expect(headers['content-security-policy']).not.toContain('https://challenges.cloudflare.com')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['x-robots-tag']).toBe('noindex, nofollow')
  })

  test(`${path} makes no third-party requests when refused`, async ({ page, baseURL }) => {
    const problems = await watchPage(page, new Set([new URL(baseURL!).origin]))
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(403)
    expect.soft(problems.thirdPartyRequests, 'requests to other origins').toEqual([])
    expect.soft(problems.pageErrors, 'script errors').toEqual([])
  })
}
