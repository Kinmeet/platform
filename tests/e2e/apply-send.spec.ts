import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'
import { APPLY, reachCheckAndSend } from './apply-helpers'
import { FAKE_TOKEN, useTurnstileStandIn } from './turnstile'

// Sending an application and every reply in docs/api/forms.md (#17). The API
// is mocked here, so these tests never store anything, and the spam check is
// a stand-in for Turnstile's script (see turnstile.ts, #148).
const trustee = en.roles.trustee
const SENT_TITLE = en.apply.sent.title.replace('{name}', 'Test Applicant')

/** Answers each send with the next reply in the list, and records the bodies. */
async function mockApply(page: Page, ...replies: { status: number; body?: unknown }[]) {
  const bodies: Record<string, unknown>[] = []
  await page.route('**/api/apply', async (route) => {
    bodies.push(route.request().postDataJSON())
    const reply = replies[Math.min(bodies.length, replies.length) - 1]!
    await route.fulfill({ status: reply.status, json: reply.body ?? null })
  })
  return bodies
}

async function send(page: Page) {
  await page.getByRole('button', { name: en.apply.send }).click()
}

function failedBox(page: Page) {
  return page.locator('.send-failed')
}

test.describe('apply send', () => {
  let turnstile: Awaited<ReturnType<typeof useTurnstileStandIn>>
  test.beforeEach(async ({ page }) => {
    turnstile = await useTurnstileStandIn(page)
  })
  test.afterEach(() => {
    expect(turnstile.realRequests(), 'the real widget should never load here').toEqual([])
  })

  test('sends the answers and shows the sent page', async ({ page }) => {
    const bodies = await mockApply(page, { status: 201, body: { ok: true, receipt: 'queued' } })
    await reachCheckAndSend(page)
    await send(page)

    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(SENT_TITLE)
    await expect(heading).toBeFocused()
    await expect(page).toHaveTitle(`Application sent, ${trustee.page.apply} – ${en.site.name}`)
    await expect(page.getByText(en.apply.sent.receipt_queued)).toBeVisible()
    await expect(
      page.getByRole('region', { name: en.apply.sent.next }).getByRole('listitem'),
    ).toHaveCount(4)
    await expect(page.getByText(trustee.page.next.reply.title)).toBeVisible()

    expect(bodies).toHaveLength(1)
    const body = bodies[0]!
    expect(body).toMatchObject({
      role: 'trustee',
      checks: { over_18: 'yes', connection_to_founders: 'no', trustee_rules_confirmed: 'yes' },
      callName: 'Test Applicant',
      email: 'test.applicant@example.com',
      // The empty optional answer is left out.
      answers: { why_trustee: 'Made-up reason for testing.' },
    })
    expect(body.submissionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(body.turnstileToken).toBe(FAKE_TOKEN)
    // The page really used the stand-in, with the apply action.
    expect(turnstile.hits()).toBeGreaterThanOrEqual(1)
    expect(await turnstile.renders()).toEqual([
      {
        sitekey: '1x00000000000000000000AA',
        action: 'apply',
        execution: 'execute',
        appearance: 'interaction-only',
      },
    ])
  })

  test('swaps Leave for Back to the roles, and empties the answers', async ({ page }) => {
    await mockApply(page, { status: 201, body: { ok: true, receipt: 'queued' } })
    await reachCheckAndSend(page)
    await send(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SENT_TITLE)

    const header = page.getByRole('banner')
    await expect(header.getByRole('link', { name: en.site.leave })).toHaveCount(0)
    await expect(page).toHaveURL(new RegExp(`${APPLY}$`))

    await page.getByRole('main').getByRole('link', { name: en.apply.sent.back_to_roles }).click()
    await expect(page).toHaveURL(/\/#roles$/)
    await page.goto('/roles/trustee')
    await page.getByRole('link', { name: trustee.page.apply }).first().click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en.apply.steps['1'])
    await expect(page.getByRole('checkbox')).not.toBeChecked()
  })

  test('says no receipt was emailed when the server sent none', async ({ page }) => {
    await mockApply(page, { status: 201, body: { ok: true, receipt: 'not_requested' } })
    await reachCheckAndSend(page)
    await send(page)
    await expect(page.getByText(en.apply.sent.receipt_not_requested)).toBeVisible()
    await expect(page.getByText(en.apply.sent.receipt_queued)).toHaveCount(0)
  })

  test('shows a refused answer on its own step and keeps the rest', async ({ page }) => {
    await mockApply(page, {
      status: 422,
      body: { ok: false, errors: [{ field: 'email', code: 'invalid_email' }] },
    })
    await reachCheckAndSend(page)
    await send(page)

    await expect(page).toHaveURL(/step=2$/)
    const summary = page.locator('.error-summary')
    await expect(summary).toBeFocused()
    await expect(summary.getByRole('link')).toHaveText([
      `${en.apply.fields.email}: ${en.apply.errors.email.invalid_email.replace("{'@'}", '@')}`,
    ])
    await expect(page.getByLabel(en.apply.about_you.callName.label)).toHaveValue('Test Applicant')
  })

  test('ends on the stop page when the server refuses an answer that stops', async ({ page }) => {
    await mockApply(page, {
      status: 422,
      body: { ok: false, errors: [{ field: 'checks.over_18', code: 'under_18' }] },
    })
    await reachCheckAndSend(page)
    await send(page)
    const heading = page.getByRole('heading', { level: 1 })
    await expect(heading).toHaveText(en.apply.stop.under_18.title)
    await expect(heading).toBeFocused()
  })

  test('asks to try again when the spam check is refused, with the same submission', async ({
    page,
  }) => {
    const bodies = await mockApply(
      page,
      {
        status: 403,
        body: { ok: false, errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }] },
      },
      // A repeat of a stored submission gets no second receipt (#80).
      { status: 200, body: { ok: true, receipt: 'not_requested' } },
    )
    await reachCheckAndSend(page)
    await send(page)

    const summary = page.locator('.error-summary')
    await expect(summary).toBeFocused()
    await expect(summary.getByRole('link')).toHaveText([
      `${en.apply.fields.spam_check}: ${en.forms.turnstile.failed}`,
    ])
    await summary.getByRole('link').click()
    await expect(page.getByRole('button', { name: en.apply.send })).toBeFocused()

    await send(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SENT_TITLE)
    expect(bodies).toHaveLength(2)
    // A new token each time, but the same id, so the server never stores it twice.
    expect(bodies[1]!.submissionId).toBe(bodies[0]!.submissionId)
    expect(bodies[1]!.turnstileToken).toBeTruthy()
    await expect(page.getByText(en.apply.sent.receipt_not_requested)).toBeVisible()
    await expect(page.getByText(en.apply.sent.receipt_queued)).toHaveCount(0)
  })

  for (const [name, reply] of [
    ['a server error', { status: 500, body: { ok: false, error: 'unavailable' } }],
    ['too many tries', { status: 429, body: { ok: false, error: 'rate_limited', retryAfter: 60 } }],
  ] as const) {
    test(`Send again after ${name} keeps the same submission`, async ({ page }) => {
      const bodies = await mockApply(page, reply, {
        status: 201,
        body: { ok: true, receipt: 'queued' },
      })
      await reachCheckAndSend(page)
      await send(page)
      await expect(failedBox(page)).toBeFocused()
      await page.getByRole('button', { name: en.apply.send_again }).click()
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(SENT_TITLE)
      expect(bodies).toHaveLength(2)
      expect(bodies[1]!.submissionId).toBe(bodies[0]!.submissionId)
    })
  }

  test('says to wait a minute when there have been too many tries', async ({ page }) => {
    await mockApply(page, {
      status: 429,
      body: { ok: false, error: 'rate_limited', retryAfter: 60 },
    })
    await reachCheckAndSend(page)
    await send(page)

    await expect(failedBox(page)).toBeFocused()
    await expect(failedBox(page)).toContainText(en.apply.failed.title)
    await expect(failedBox(page)).toContainText(en.apply.failed.rate_limited)
    await expect(page.getByRole('button', { name: en.apply.send_again })).toBeVisible()
  })

  for (const [name, fulfil] of [
    ['a server error', { status: 500, body: { ok: false, error: 'unavailable' } }],
    ['a bad request', { status: 400, body: { ok: false, error: 'bad_request' } }],
    [
      'a closed role',
      { status: 422, body: { ok: false, errors: [{ field: 'role', code: 'role_closed' }] } },
    ],
  ] as const) {
    test(`shows That didn't send after ${name}, keeping every answer`, async ({ page }) => {
      await mockApply(page, fulfil)
      await reachCheckAndSend(page)
      await send(page)
      await expect(failedBox(page)).toBeFocused()
      await expect(failedBox(page)).toContainText(en.apply.failed.unavailable)
      await expect(page).toHaveURL(/step=4$/)
      await expect(page.locator('dl.answers').getByText('Test Applicant')).toBeVisible()
    })
  }

  test("shows That didn't send when the connection drops", async ({ page }) => {
    await page.route('**/api/apply', (route) => route.abort('internetdisconnected'))
    await reachCheckAndSend(page)
    await send(page)
    await expect(failedBox(page)).toContainText(en.apply.failed.unavailable)
  })

  test("says the spam check couldn't load, and sends nothing", async ({ page }) => {
    const sends: Request[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST') sends.push(request)
    })
    await page.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.abort('blockedbyclient'))
    await reachCheckAndSend(page)
    await expect(page.getByText(en.forms.turnstile.unavailable)).toBeVisible()
    await send(page)
    await expect(failedBox(page)).toBeFocused()
    await expect(failedBox(page)).toContainText(en.apply.failed.spam_check)
    expect(sends).toEqual([])
  })

  test('copies the answers, and confirms it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    const bodies = await mockApply(page, { status: 500 })
    await reachCheckAndSend(page)
    await send(page)

    await page.getByRole('button', { name: en.apply.failed.copy }).click()
    await expect(failedBox(page).getByRole('status')).toHaveText(en.apply.failed.copied)
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain(`${en.apply.fields.callName}: Test Applicant`)
    expect(copied).toContain('Made-up reason for testing.')
    // Only their answers: no id or spam check token.
    expect(copied).not.toContain(String(bodies[0]!.submissionId))
    expect(copied).not.toContain(String(bodies[0]!.turnstileToken))
  })

  test('shows the answers to copy by hand when the clipboard is blocked', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.reject(new Error('blocked')) },
      })
    })
    await mockApply(page, { status: 500 })
    await reachCheckAndSend(page)
    await send(page)

    await page.getByRole('button', { name: en.apply.failed.copy }).click()
    await expect(failedBox(page).getByRole('status')).toHaveText(en.apply.failed.copy_fallback)
    const box = page.getByLabel(en.apply.failed.copy_box_label, { exact: true })
    await expect(box).toBeFocused()
    await expect(box).toHaveValue(/Test Applicant/)
  })

  test('the sent page and the failed box have no automatically detectable WCAG 2.2 AA failures', async ({
    page,
  }) => {
    await mockApply(page, { status: 500 }, { status: 201, body: { ok: true, receipt: 'queued' } })
    await reachCheckAndSend(page)
    const scan = async () => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    }
    await send(page)
    await expect(failedBox(page)).toBeVisible()
    await scan()
    await page.getByRole('button', { name: en.apply.send_again }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(SENT_TITLE)
    await scan()
  })
})
