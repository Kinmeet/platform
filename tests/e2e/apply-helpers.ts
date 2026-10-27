import { expect, type Page } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }

// Steps through the trustee application with made-up answers.
const questions = en.roles.trustee.questions
export const APPLY = '/roles/trustee/apply'

export async function openApply(page: Page, path = APPLY) {
  await page.goto(path, { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

export async function continueOn(page: Page) {
  await page.getByRole('button', { name: en.apply.continue }).click()
}

export async function finishStep1(page: Page) {
  await page
    .getByRole('group', { name: questions.over_18.label })
    .getByRole('radio', { name: questions.over_18.choices.yes })
    .check()
  await page
    .getByRole('group', { name: questions.connection_to_founders.label })
    .getByRole('radio', { name: questions.connection_to_founders.choices.no, exact: true })
    .check()
  await page.getByRole('checkbox', { name: questions.trustee_rules_confirmed.label }).check()
  await continueOn(page)
  await expect(page).toHaveURL(/step=2$/)
}

export async function finishStep2(page: Page) {
  await page.getByLabel(en.apply.about_you.callName.label).fill('Test Applicant')
  await page.getByLabel(en.apply.about_you.email.label).fill('test.applicant@example.com')
  await continueOn(page)
  await expect(page).toHaveURL(/step=3$/)
}

export async function finishStep3(page: Page) {
  await page.getByLabel(questions.why_trustee.label).fill('Made-up reason for testing.')
  await continueOn(page)
  await expect(page).toHaveURL(/step=4$/)
}

/** Opens the flow and answers everything, ending on Check and send. */
export async function reachCheckAndSend(page: Page) {
  await openApply(page)
  await finishStep1(page)
  await finishStep2(page)
  await finishStep3(page)
}
