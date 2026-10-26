import { expect, test } from '@playwright/test'
import { adminRoutes } from '../../shared/routes'

// Admin pages sit behind Cloudflare Access. Locally there is no Access
// configuration and no token, so every admin route must refuse, and the
// refusal must still carry the security headers and never be indexed.
for (const path of adminRoutes) {
  test(`${path} refuses a request with no Access token, with the security headers`, async ({
    request,
  }) => {
    const response = await request.get(path, { maxRedirects: 0 })
    expect(response.status()).toBe(403)

    const headers = response.headers()
    const policy = headers['content-security-policy'] ?? ''
    expect(policy).toContain("default-src 'self'")
    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).not.toContain('https://challenges.cloudflare.com')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['referrer-policy']).toBe('no-referrer')
    expect(headers['x-robots-tag']).toContain('noindex')
  })
}
