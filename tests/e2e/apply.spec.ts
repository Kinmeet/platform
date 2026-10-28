import { expect, test } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { publicRoutes } from '../../shared/routes'
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'
import {
  APPLY,
  continueOn,
  finishStep1,
  finishStep2,
  finishStep3,
  openApply as open,
} from './apply-helpers'
import { allowedOrigins, watchPage } from './helpers'
import { watchOwnRequests, watchRealTurnstile } from './turnstile'

// The apply flow's step pages (#15). Test answers are made up.
const trustee = en.roles.trustee
const questions = trustee.questions

test.describe('apply flow steps', () => {
  test('starts at step 1 with the role and progress', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
    await expect(page.getByText(`Applying for: ${trustee.title}`)).toBeVisible()
    await expect(page).toHaveTitle(
      `Step 1 of 4: Check it fits, ${trustee.page.apply} – ${en.site.name}`,
    )
  })

  test('shows an error summary, focuses it and links each item to its field', async ({ page }) => {
    await open(page)
    await continueOn(page)

    const summary = page.locator('.error-summary')
    await expect(summary).toBeFocused()
    await expect(summary.getByRole('heading')).toHaveText('There are 3 things to fix')
    await expect(page).toHaveTitle(/^Error: Step 1 of 4/)
    // Each item names its question, so no two read the same (Robin, #78).
    await expect(summary.getByRole('link')).toHaveText([
      `${questions.over_18.summary}: ${en.apply.errors.choice_required}`,
      `${questions.connection_to_founders.summary}: ${en.apply.errors.choice_required}`,
      `${questions.trustee_rules_confirmed.summary}: ${en.apply.errors.confirm_required}`,
    ])

    await summary.getByRole('link').first().click()
    await expect(
      page.getByRole('radio', { name: questions.over_18.choices.yes, exact: true }),
    ).toBeFocused()
    await expect(
      page.getByRole('group', { name: questions.over_18.label }),
    ).toHaveAccessibleDescription(en.apply.errors.choice_required)
  })

  test('marks invalid fields and describes them by their message', async ({ page }) => {
    await open(page)
    await finishStep1(page)
    await page.getByLabel(en.apply.about_you.email.label).fill('test@example')
    await continueOn(page)

    const email = page.getByLabel(en.apply.about_you.email.label)
    await expect(email).toHaveAttribute('aria-invalid', 'true')
    await expect(email).toHaveAccessibleDescription(
      `${en.apply.about_you.email.hint} ${en.apply.errors.email.invalid_email.replace("{'@'}", '@')}`,
    )
    await expect(page.getByLabel(en.apply.about_you.callName.label)).toHaveAttribute(
      'aria-invalid',
      'true',
    )
  })

  test('moves focus to the heading on each new step', async ({ page }) => {
    await open(page)
    await finishStep1(page)
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(en.apply.steps['2'])
    await expect(heading).toBeFocused()
    await expect(page).toHaveTitle(/^Step 2 of 4: About you/)
  })

  test('lists every answer on Check and send, with Change links', async ({ page }) => {
    await open(page)
    await finishStep1(page)
    await finishStep2(page)
    await finishStep3(page)

    const answers = page.locator('dl.answers')
    for (const text of [
      questions.over_18.choices.yes,
      questions.trustee_rules_confirmed.choices.yes,
      'Test Applicant',
      'test.applicant@example.com',
      'Made-up reason for testing.',
      en.apply.no_answer,
    ]) {
      await expect(answers.getByText(text, { exact: true }).first()).toBeVisible()
    }
    await expect(page.getByText(en.apply.where_it_goes.body)).toBeVisible()
    // The trustee purpose takes free text, so its safety note shows (SG6, Ezra #162).
    await expect(page.getByText(en.forms.safety_note)).toBeVisible()

    await page.getByRole('link', { name: 'Change your answers: About you' }).click()
    await expect(page).toHaveURL(/step=2$/)
    await expect(page.getByLabel(en.apply.about_you.callName.label)).toHaveValue('Test Applicant')
  })

  test('Back goes to the step before and keeps the answers', async ({ page }) => {
    await open(page)
    await finishStep1(page)
    await page.getByLabel(en.apply.about_you.callName.label).fill('Test Applicant')
    await page.getByRole('button', { name: en.apply.back }).click()
    await expect(page).toHaveURL(new RegExp(`${APPLY}$`))
    await expect(page.getByRole('checkbox')).toBeChecked()
    await continueOn(page)
    await expect(page.getByLabel(en.apply.about_you.callName.label)).toHaveValue('Test Applicant')
  })

  // The spam check loads only once it's needed (Callum, #81), so anyone who
  // stops at step 1 never contacts Cloudflare. Reached by clicking through
  // from the role page, so it also proves the new document's policy lets it
  // load (Nadia, #74).
  test('loads the spam check on Check and send, and not before', async ({ page, baseURL }) => {
    const route = publicRoutes.find((item) => item.path === APPLY)!
    const problems = await watchPage(
      page,
      allowedOrigins(route, baseURL!),
      new URL(baseURL!).origin,
    )
    // The real widget, as in no-third-party.spec.ts (#148).
    const own = watchOwnRequests(page, new URL(baseURL!).origin)
    await page.goto('/roles/trustee')
    await page.getByRole('link', { name: trustee.page.apply }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
    await finishStep1(page)
    await finishStep2(page)
    await own.settled()
    expect(problems.otherOrigins, 'nothing from Cloudflare before step 4').toEqual([])

    const turnstile = watchRealTurnstile(page)
    await finishStep3(page)
    await turnstile.loaded()
    await own.settled()
    expect(problems.otherOrigins).toEqual([TURNSTILE_ORIGIN])
    expect(problems.cspViolations).toEqual([])
    expect(problems.pageErrors).toEqual([])
    expect(problems.thirdPartyRequests).toEqual([])
    await expect(page.getByText(en.forms.turnstile.unavailable)).toHaveCount(0)
  })

  test('a later step cannot be opened directly, and says why', async ({ page }) => {
    await open(page, `${APPLY}?step=4`)
    await expect(page).toHaveURL(new RegExp(`${APPLY}$`))
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
    await expect(
      page.getByRole('status').filter({ hasText: en.apply.redirect.restarted }),
    ).toBeVisible()
  })

  test('Leave empties the answers (Theo, #78)', async ({ page }) => {
    await open(page)
    await finishStep1(page)
    await page.getByLabel(en.apply.about_you.callName.label).fill('Test Applicant')
    await page.getByRole('link', { name: en.site.leave }).click()
    await expect(page).toHaveURL(/\/roles\/trustee$/)

    await page.getByRole('link', { name: trustee.page.apply }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
    await expect(page.getByRole('checkbox')).not.toBeChecked()
    await expect(
      page.getByRole('radio', { name: questions.over_18.choices.yes, exact: true }),
    ).not.toBeChecked()
  })

  test('has no footer, to keep the form clear', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('contentinfo')).toHaveCount(0)
  })
})

test.describe('apply flow progress', () => {
  test('shows the step list on a wide screen, with the current step marked', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open(page)
    const steps = page.getByRole('list', { name: en.apply.steps_label })
    await expect(steps).toBeVisible()
    await expect(steps.locator('[aria-current="step"]')).toContainText(en.apply.steps['1'])
    await expect(steps.locator('[aria-current="step"]')).toContainText(en.apply.step_status.current)
    await expect(page.getByText('Step 1 of 4: Check it fits')).toBeHidden()
  })

  test('shows the progress line on a phone instead', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 })
    await open(page)
    await expect(page.getByText('Step 1 of 4: Check it fits')).toBeVisible()
    await expect(page.getByRole('list', { name: en.apply.steps_label })).toBeHidden()
    const width = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(width).toBeLessThanOrEqual(390)
  })
})

test.describe('apply flow without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('says the form needs JavaScript (Rowan, F)', async ({ page }) => {
    await page.goto(APPLY)
    // Playwright's text locators skip <noscript>, so check the rendered box.
    const shown = await page.evaluate(() => {
      const note = document.querySelector('.apply__noscript')
      return note
        ? { text: note.textContent?.trim(), height: note.getBoundingClientRect().height }
        : null
    })
    expect(shown?.text).toBe(en.apply.noscript)
    expect(shown?.height).toBeGreaterThan(0)
  })
})
