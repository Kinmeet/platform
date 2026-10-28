import { expect, test, type Page } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'
import { waitForApp } from './helpers'
import { watchOwnRequests, watchRealTurnstile } from './turnstile'

// The security policy is set per document, so following a link onto or off a
// form page must load a new document (#20, Nadia's review). These tests click
// real links rather than loading each page directly.
const formRoutes = publicRoutes.filter((route) => route.form)
const otherRoutes = publicRoutes.filter((route) => !route.form)

/** Marks the current document, so a later check can tell if it was replaced. */
async function markDocument(page: Page) {
  await page.evaluate(() => ((window as { kinmeetMark?: boolean }).kinmeetMark = true))
}

async function isSameDocument(page: Page) {
  return page.evaluate(() => (window as { kinmeetMark?: boolean }).kinmeetMark === true)
}

function turnstileRequests(page: Page, { fromNextDocument = false } = {}) {
  const seen: string[] = []
  // The page being left can still finish loading its own widget, so after
  // leaving only the new document's requests count (#148).
  let counting = !fromNextDocument
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) counting = true
  })
  page.on('request', (request) => {
    if (counting && new URL(request.url()).origin === TURNSTILE_ORIGIN) seen.push(request.url())
  })
  return seen
}

/** The first page, other than a form page, that links to `path`. */
async function pageLinkingTo(page: Page, path: string) {
  for (const route of otherRoutes) {
    await page.goto(route.path)
    if ((await page.locator(`a[href="${path}"]`).count()) > 0) return route.path
  }
  return undefined
}

test('links between ordinary pages stay in the app', async ({ page }) => {
  await page.goto('/')
  await waitForApp(page)
  await markDocument(page)
  // The home link in the header is a client-side link to an ordinary page.
  await page.getByRole('banner').getByRole('link', { name: 'Kinmeet' }).click()
  await expect(page).toHaveURL(/\/$/)
  expect(await isSameDocument(page)).toBe(true)
})

for (const route of formRoutes) {
  test(`following a link to ${route.path} loads it fresh, with the spam check`, async ({
    page,
  }) => {
    const from = await pageLinkingTo(page, route.path)
    expect(from, `some page should link to ${route.path}`).toBeDefined()
    await page.goto(from!)
    await markDocument(page)
    const requests = turnstileRequests(page)

    await page.locator(`a[href="${route.path}"]`).first().click()
    await expect(page).toHaveURL(new RegExp(`${route.path}$`))
    expect(await isSameDocument(page), 'should be a new document').toBe(false)
    const policy = await page.evaluate(async () => {
      const response = await fetch(location.href)
      return response.headers.get('content-security-policy') ?? ''
    })
    expect(policy, 'the new document should allow the spam check').toContain(TURNSTILE_ORIGIN)
    if (route.spamCheckOnLoad === false) {
      // Its spam check is on a later step; apply.spec.ts checks it loads there.
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await page.waitForTimeout(1000)
      expect(requests, 'no spam check before it is needed').toEqual([])
    } else {
      await expect
        .poll(() => requests.length, { message: 'spam check should load' })
        .toBeGreaterThan(0)
    }
  })

  test(`leaving ${route.path} by a link loads a fresh page without the spam check`, async ({
    page,
    baseURL,
  }) => {
    // Our own requests, not networkidle, which Turnstile can hold off (#148).
    const own = watchOwnRequests(page, new URL(baseURL!).origin)
    const turnstile = route.spamCheckOnLoad === false ? undefined : watchRealTurnstile(page)
    await page.goto(route.path)
    await waitForApp(page)
    await turnstile?.loaded()
    await own.settled()
    await markDocument(page)
    const requests = turnstileRequests(page, { fromNextDocument: true })

    await page.getByRole('banner').getByRole('link').first().click()
    await page.waitForLoadState('load')
    await own.settled()
    expect(await isSameDocument(page), 'should be a new document').toBe(false)
    expect(requests, 'no spam check requests after leaving').toEqual([])
    const policy = await page.evaluate(async () => {
      const response = await fetch(location.href)
      return response.headers.get('content-security-policy') ?? ''
    })
    expect(policy).not.toContain(TURNSTILE_ORIGIN)
  })
}
