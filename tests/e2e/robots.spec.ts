import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'

// No environment is indexed yet (#106): staging and Previews never will be,
// and live waits for the founder's M1 review. @nuxtjs/robots sends the
// header and meta tag on every page and serves a robots.txt that disallows
// everything.
test.describe('search engines', () => {
  for (const { path } of publicRoutes) {
    test(`are told not to index ${path}`, async ({ page }) => {
      const response = await page.goto(path)
      expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow')
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        'content',
        'noindex, nofollow',
      )
    })
  }

  test('are told not to index a page that isn’t found', async ({ request }) => {
    const response = await request.get('/no-such-page')
    expect(response.status()).toBe(404)
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('are kept out of the whole site by robots.txt', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/plain')
    const lines = (await response.text()).split('\n').map((line) => line.trim())
    expect(lines).toContain('User-agent: *')
    expect(lines).toContain('Disallow: /')
    expect(lines.filter((line) => line.startsWith('Allow:'))).toEqual([])
  })

  test('robots.txt carries the security headers', async ({ request }) => {
    const response = await request.get('/robots.txt')
    const headers = response.headers()
    expect(headers['content-security-policy']).toContain("default-src 'self'")
    expect(headers['x-content-type-options']).toBe('nosniff')
  })
})
