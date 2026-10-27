import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { trustee as config } from '../../shared/forms/roles/trustee'

// Step 1's role-specific parts (#16): notes after a choice, the GOV.UK
// link, the DBS note, and the stop pages.
const trustee = en.roles.trustee
const questions = trustee.questions
const APPLY = '/roles/trustee/apply'

async function open(page: Page) {
  await page.goto(APPLY, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
}

function choose(page: Page, question: keyof typeof questions, label: string) {
  return page
    .getByRole('group', { name: questions[question].label })
    .getByRole('radio', { name: label, exact: true })
    .check()
}

async function answerRest(page: Page) {
  await page.getByRole('checkbox', { name: questions.trustee_rules_confirmed.label }).check()
}

test.describe('apply step 1', () => {
  test('shows a note for a connection that needs talking through', async ({ page }) => {
    await open(page)
    const connection = questions.connection_to_founders
    const group = page.getByRole('group', { name: connection.label })

    await choose(page, 'connection_to_founders', connection.choices.friend_or_acquaintance)
    await expect(group.getByText(connection.notes.friend_or_acquaintance)).toBeVisible()

    await choose(page, 'connection_to_founders', connection.choices.not_sure)
    await expect(group.getByText(connection.notes.not_sure)).toBeVisible()
    await expect(group.getByText(connection.notes.friend_or_acquaintance)).toHaveCount(0)

    await choose(page, 'connection_to_founders', connection.choices.no)
    await expect(group.locator('.apply-question__note')).toHaveText('')
  })

  test('a connection note lets the visitor carry on', async ({ page }) => {
    await open(page)
    await choose(page, 'over_18', questions.over_18.choices.yes)
    await choose(
      page,
      'connection_to_founders',
      questions.connection_to_founders.choices.friend_or_acquaintance,
    )
    await answerRest(page)
    await page.getByRole('button', { name: en.apply.continue }).click()
    await expect(page).toHaveURL(/step=2$/)
  })

  test('links to the trustee rules in a new tab, without sending a referrer', async ({ page }) => {
    await open(page)
    const link = page.getByRole('link', { name: questions.trustee_rules_confirmed.link })
    await expect(link).toHaveAttribute('href', config.apply.checks[2].link)
    await expect(link).toHaveAttribute('target', '_blank')
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })

  test('explains the DBS check', async ({ page }) => {
    await open(page)
    await expect(page.getByText(trustee.apply.note.heading)).toBeVisible()
    await expect(page.getByText(trustee.apply.note.body)).toBeVisible()
  })
})

test.describe('apply stop pages', () => {
  test('under 18 ends on its own page, and Back keeps the answers', async ({ page }) => {
    await open(page)
    await choose(page, 'over_18', questions.over_18.choices.no)
    await choose(page, 'connection_to_founders', questions.connection_to_founders.choices.no)
    await answerRest(page)
    await page.getByRole('button', { name: en.apply.continue }).click()

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(en.apply.stop.under_18.title)
    await expect(heading).toBeFocused()
    await expect(page).toHaveTitle(
      `${en.apply.stop.under_18.title}, ${trustee.page.apply} – ${en.site.name}`,
    )
    await expect(page.getByText(en.apply.stop.under_18.next)).toBeVisible()
    // Every role needs an adult, so there's no list of other roles here.
    await expect(page.getByRole('link', { name: en.apply.stop.see_roles })).toHaveCount(0)
    // No invitation to write in until area 5 decides on under-13s (#82).
    await expect(page.getByRole('link', { name: en.apply.stop.say_hello })).toHaveCount(0)
    // The flow has ended, so there's no step progress (Robin).
    await expect(page.getByText('Step 1 of 4: Check it fits')).toHaveCount(0)
    await expect(page.getByRole('list', { name: en.apply.steps_label })).toHaveCount(0)

    await page.getByRole('button', { name: en.apply.back }).click()
    await expect(heading).toHaveText(en.apply.steps['1'])
    await expect(
      page.getByRole('radio', { name: questions.over_18.choices.no, exact: true }).first(),
    ).toBeChecked()
  })

  test('a related or same-household connection ends on the independence page', async ({ page }) => {
    await open(page)
    await choose(page, 'over_18', questions.over_18.choices.yes)
    await choose(
      page,
      'connection_to_founders',
      questions.connection_to_founders.choices.related_or_household,
    )
    await answerRest(page)
    await page.getByRole('button', { name: en.apply.continue }).click()

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      en.apply.stop.not_independent.title,
    )
    await page.getByRole('link', { name: en.apply.stop.see_roles }).click()
    await expect(page).toHaveURL(/\/#roles$/)
  })

  test('stop pages have no automatically detectable WCAG 2.2 AA failures', async ({ page }) => {
    await open(page)
    await choose(page, 'over_18', questions.over_18.choices.no)
    await choose(page, 'connection_to_founders', questions.connection_to_founders.choices.no)
    await answerRest(page)
    await page.getByRole('button', { name: en.apply.continue }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.stop.under_18.title)

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
  })
})
