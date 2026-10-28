import { expect, test } from '@playwright/test'
import { draftRoutes, publicRoutes } from '../../shared/routes'

// Pages that are built but not published yet, such as the all-ages promise
// (#77) and the privacy notice (#144). Each must answer 404 and have no link to it anywhere public. Once
// published, a page moves to `publicRoutes` and the no-third-party and
// accessibility tests load it instead.
for (const path of draftRoutes) {
  test.describe(`draft page ${path}`, () => {
    test('answers 404', async ({ request }) => {
      const response = await request.get(path)
      expect(response.status()).toBe(404)
    })

    // Every public page, so in-page links such as say hello's link to the
    // privacy notice are covered as well as the header and footer.
    for (const { path: from } of publicRoutes) {
      test(`isn’t linked from ${from}`, async ({ page }) => {
        await page.goto(from)
        await expect(page.locator(`a[href^="${path}"]`)).toHaveCount(0)
      })
    }
  })
}
