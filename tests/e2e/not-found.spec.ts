import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { publicRoutes } from '../../shared/routes'
import { hasPage } from '../../shared/site-nav'
import { waitForApp, watchPage } from './helpers'

// The missing page (#18, W10) and a crawl of every internal link on the
// pre-launch pages, so no page links somewhere that isn't built yet.
const notFound = en.error_page.not_found
const MISSING = '/a-page-that-does-not-exist'

test.describe('missing page', () => {
  test('answers 404 with a friendly page and a way home', async ({ page }) => {
    const response = await page.goto(MISSING, { waitUntil: 'networkidle' })
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(notFound.title)
    await expect(page.getByText(notFound.body)).toBeVisible()
    await expect(page).toHaveTitle(`${notFound.page_title} – ${en.site.name}`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en-GB')
    // In the site shell, with the header and footer.
    await expect(page.locator('header.site-header')).toBeVisible()
    await expect(page.locator('main#main')).toBeVisible()

    const patch = page.locator('.error-page')
    await expect(patch.getByRole('link', { name: en.error_page.home })).toHaveAttribute('href', '/')
    const sayHello = patch.getByRole('link', { name: en.site.nav.say_hello })
    if (hasPage('/say-hello')) await expect(sayHello).toHaveAttribute('href', '/say-hello')
    else await expect(sayHello).toHaveCount(0)
  })

  test('also covers a role that is not published', async ({ page }) => {
    const response = await page.goto('/roles/not-a-real-role')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(notFound.title)
  })

  test('the home link leaves the error behind', async ({ page }) => {
    await page.goto(MISSING)
    await waitForApp(page)
    await page.locator('.error-page').getByRole('link', { name: en.error_page.home }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.home.hero.title)
  })

  test('makes no third-party requests and no policy violations', async ({ page, baseURL }) => {
    const origin = new URL(baseURL!).origin
    const problems = await watchPage(page, new Set([origin]), origin)
    const response = await page.goto(MISSING, { waitUntil: 'networkidle' })
    expect(response?.headers()['content-security-policy']).toContain("default-src 'self'")
    expect.soft(problems.thirdPartyRequests).toEqual([])
    expect.soft(problems.cspViolations).toEqual([])
    expect.soft(problems.pageErrors).toEqual([])
    expect.soft(problems.otherOrigins).toEqual([])
  })

  test('has no automatically detectable WCAG 2.2 AA failures', async ({ page }) => {
    await page.goto(MISSING, { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})

test('every internal link on the pre-launch pages goes somewhere that exists', async ({
  page,
  request,
  baseURL,
}) => {
  const origin = new URL(baseURL!).origin
  // Each link target, with the pages that link to it.
  const links = new Map<string, Set<string>>()
  for (const route of publicRoutes) {
    await page.goto(route.path, { waitUntil: 'networkidle' })
    const hrefs = await page
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
    for (const href of hrefs) {
      const url = new URL(href)
      if (url.origin !== origin) continue
      const target = url.pathname + url.hash
      links.set(target, (links.get(target) ?? new Set()).add(route.path))
    }
  }
  expect(links.size, 'the crawl should find links').toBeGreaterThan(0)

  for (const [target, from] of links) {
    const [path, hash] = target.split('#') as [string, string | undefined]
    const where = `${target} (linked from ${[...from].join(', ')})`
    const response = await request.get(path)
    expect.soft(response.status(), where).toBe(200)
    if (hash) {
      await page.goto(path)
      await expect.soft(page.locator(`[id="${hash}"]`), where).toHaveCount(1)
    }
  }
})
