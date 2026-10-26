import { expect, test } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { roles } from '../../shared/forms/roles'

// Role pages (#13). Published roles get a page; draft and unknown roles 404.
test.describe('role page', () => {
  const trustee = en.roles.trustee

  test('shows the trustee page', async ({ page }) => {
    await page.goto('/roles/trustee')
    await expect(page).toHaveTitle(`${trustee.title} – Kinmeet`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(trustee.title)
    for (const section of Object.values(trustee.page.sections)) {
      await expect(page.getByRole('heading', { level: 2, name: section.heading })).toBeVisible()
    }
  })

  test('lists every "At a glance" row as a term and its value', async ({ page }) => {
    await page.goto('/roles/trustee')
    const glance = page.getByRole('complementary', { name: en.role_page.glance })
    for (const row of Object.values(trustee.page.glance)) {
      await expect(glance.getByRole('term').filter({ hasText: row.label })).toHaveCount(1)
      await expect(glance.getByRole('definition').filter({ hasText: row.value })).toHaveCount(1)
    }
  })

  test('numbers the steps after applying as an ordered list', async ({ page }) => {
    await page.goto('/roles/trustee')
    const steps = page.getByRole('region', { name: en.role_page.next }).getByRole('listitem')
    await expect(steps).toHaveCount(Object.keys(trustee.page.next).length)
  })

  test('gives each step a heading, so people can jump between them', async ({ page }) => {
    await page.goto('/roles/trustee')
    const next = page.getByRole('region', { name: en.role_page.next })
    await expect(next.getByRole('heading', { level: 3 })).toHaveCount(
      Object.keys(trustee.page.next).length,
    )
  })

  test('keeps the landmark list short: body sections are not regions', async ({ page }) => {
    await page.goto('/roles/trustee')
    for (const { heading } of Object.values(trustee.page.sections)) {
      await expect(page.getByRole('heading', { level: 2, name: heading })).toBeVisible()
      await expect(page.getByRole('region', { name: heading })).toHaveCount(0)
    }
  })

  test('links back to the roles list on the home page', async ({ page }) => {
    await page.goto('/roles/trustee')
    await page.getByRole('link', { name: en.role_page.all_roles }).click()
    await expect(page).toHaveURL(/\/#roles$/)
    await expect(page.locator('#roles')).toBeVisible()
  })

  test('is a 404 for draft and unknown roles', async ({ request }) => {
    const drafts = roles.filter((role) => !role.published).map((role) => role.slug)
    expect(drafts.length).toBeGreaterThan(0)
    for (const slug of [...drafts, 'not-a-role']) {
      const response = await request.get(`/roles/${slug}`)
      expect(response.status(), slug).toBe(404)
    }
  })
})
