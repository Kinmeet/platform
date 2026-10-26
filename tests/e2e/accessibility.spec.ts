import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { publicRoutes } from '../../shared/routes'

// Automated WCAG 2.2 AA scan of every public page. This catches the
// mechanical failures; manual keyboard and screen-reader checks still happen
// in accessibility review (P11).
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

for (const route of publicRoutes) {
  test(`${route.path} has no automatically detectable WCAG 2.2 AA failures`, async ({ page }) => {
    await page.goto(route.path, { waitUntil: 'networkidle' })

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
