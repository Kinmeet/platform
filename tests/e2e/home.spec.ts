import { expect, test } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }

// The pre-launch home page (#12).
test.describe('home page', () => {
  test('has one main heading', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.home.hero.title)
  })

  test('lists published roles only (Q3)', async ({ page }) => {
    await page.goto('/')
    const list = page
      .locator('#roles')
      .getByRole('listitem')
      .filter({ has: page.locator('h3') })
    await expect(list).toHaveCount(1)
    await expect(list.getByRole('heading', { level: 3 })).toHaveText(en.roles.trustee.title)
    for (const draft of ['treasurer', 'safeguarding-lead', 'artist-mark'] as const) {
      await expect(page.getByText(en.roles[draft].title, { exact: true })).toHaveCount(0)
    }
  })

  test('labels the illustration', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('img', { name: en.home.hero.art_label })).toBeVisible()
  })

  test('says the policies are adopted before anyone volunteers and public before the first meet', async ({
    page,
  }) => {
    await page.goto('/')
    const band = page.getByRole('region', { name: en.home.parents.title })
    await expect(band).toContainText('adopt them before anyone volunteers at a meet')
    await expect(band).toContainText('be public before the first meet')
  })

  test('has a title that says what the page is for', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle('Help us start Kinmeet – Kinmeet')
  })

  test('every link on the page goes somewhere that exists', async ({ page, request }) => {
    await page.goto('/')
    const links = await page
      .locator('a[href]')
      .evaluateAll((anchors) => anchors.map((anchor) => (anchor as HTMLAnchorElement).href))
    for (const href of new Set(links)) {
      const url = new URL(href)
      const response = await request.get(url.pathname)
      expect(response.status(), href).toBe(200)
      if (url.hash && url.pathname === '/') {
        await expect(page.locator(url.hash), href).toHaveCount(1)
      }
    }
  })
})
