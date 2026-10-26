import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'

// The shell every page uses (#11). Runs on every public route so a new page
// can't drop the skip link, landmarks or title pattern.
for (const route of publicRoutes) {
  test.describe(`${route.path} shell`, () => {
    // The apply flow's focused layout has no footer, to keep the form clear (W6).
    test(`has one header and main landmark, and ${route.focused ? 'no' : 'one'} footer`, async ({
      page,
    }) => {
      await page.goto(route.path)
      await expect(page.getByRole('banner')).toHaveCount(1)
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(page.getByRole('contentinfo')).toHaveCount(route.focused ? 0 : 1)
    })

    test('has a skip link that is the first thing to focus', async ({ page }) => {
      await page.goto(route.path)
      await page.keyboard.press('Tab')
      const skip = page.getByRole('link', { name: 'Skip to main content' })
      await expect(skip).toBeFocused()
      await expect(skip).toBeInViewport()
      await page.keyboard.press('Enter')
      await expect(page.getByRole('main')).toBeFocused()
    })

    test('puts the site name after the page title', async ({ page }) => {
      await page.goto(route.path)
      await expect(page).toHaveTitle(/^.+ – Kinmeet$/)
    })

    test('has no links in the header or footer to missing pages', async ({ page, request }) => {
      await page.goto(route.path)
      const hrefs = await page
        .locator('header a[href], footer a[href]')
        .evaluateAll((links) => links.map((link) => (link as HTMLAnchorElement).href))
      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of new Set(hrefs)) {
        const response = await request.get(href)
        expect(response.status(), href).toBe(200)
        // A link to a section must land on it (Robin, #68).
        const url = new URL(href)
        if (url.hash) {
          await page.goto(url.pathname)
          await expect(page.locator(url.hash), href).toHaveCount(1)
        }
      }
    })
  })
}

test('the footer links to both font licences', async ({ page, request }) => {
  await page.goto('/')
  const footer = page.getByRole('contentinfo')
  for (const [name, path] of [
    ['Fredoka', '/fonts/Fredoka-OFL.txt'],
    ['Atkinson Hyperlegible Next', '/fonts/AtkinsonHyperlegibleNext-OFL.txt'],
  ] as const) {
    const link = footer.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('href', path)
    const response = await request.get(path)
    expect(response.status()).toBe(200)
    expect(await response.text()).toContain('SIL OPEN FONT LICENSE')
  }
})
