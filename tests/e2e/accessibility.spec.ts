import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'
import { watchOwnRequests, watchRealTurnstile } from './turnstile'

// Automated WCAG 2.2 AA scan of every public page. This catches the
// mechanical failures; manual keyboard and screen-reader checks still happen
// in accessibility review (P11).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const route of publicRoutes) {
  test(`${route.path} has no automatically detectable WCAG 2.2 AA failures`, async ({
    page,
    baseURL,
  }) => {
    // The real spam check where the page has one, but not networkidle, which
    // Turnstile's challenge can hold off (#148).
    const own = watchOwnRequests(page, new URL(baseURL!).origin)
    const turnstile =
      route.form && route.spamCheckOnLoad !== false ? watchRealTurnstile(page) : undefined
    await page.goto(route.path)
    await turnstile?.loaded()
    await own.settled()

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()

    const failures = results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
    expect(failures).toEqual([])
  })
}
