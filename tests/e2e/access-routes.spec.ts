import { expect, test } from '@playwright/test'
import { accessRoutes } from '../../shared/routes'
import { watchPage } from './helpers'

// Pages behind Cloudflare Access are never public. Locally there is no Access
// configuration and no token, so each one must refuse, still send the P5
// headers, never be indexed, and load nothing from another origin (rule 1).
for (const path of accessRoutes) {
  test(`${path} refuses without Access, with the security headers`, async ({ request }) => {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status()).toBe(403)

    const headers = response.headers()
    const policy = headers['content-security-policy'] ?? ''
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toContain('https://challenges.cloudflare.com')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['x-robots-tag']).toContain('noindex')
  })

  test(`${path} makes no third-party requests when refused`, async ({ page, baseURL }) => {
    const ownOrigin = new URL(baseURL!).origin
    const problems = await watchPage(page, new Set([ownOrigin]), ownOrigin)
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(403)
    expect.soft(problems.thirdPartyRequests, 'requests to other origins').toEqual([])
    expect.soft(problems.cspViolations, 'content security policy violations').toEqual([])
    expect.soft(problems.pageErrors, 'script errors').toEqual([])
  })
}
