import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page, type Request } from '@playwright/test'
import en from '../../i18n/locales/en-GB.json' with { type: 'json' }
import { TURNSTILE_ORIGIN } from '../../shared/turnstile'

// Say hello (#14). The API is mocked, so these tests never store anything;
// the spam check is Cloudflare's always-passing test key. Names and emails
// are made up.
const hello = en.hello
const SENT_TITLE = hello.sent.title.replace('{name}', 'Test Organiser')

async function open(page: Page) {
  await page.goto('/say-hello', { waitUntil: 'networkidle' })
  await expect(page.getByRole('heading', { level: 2, name: hello.form_title })).toBeVisible()
}

async function fillIn(page: Page) {
  await page.getByLabel(hello.callName.label).fill('Test Organiser')
  await page.getByLabel(hello.email.label).fill('test.organiser@example.com')
  await page.getByLabel(hello.message.label, { exact: true }).fill('A made-up message for testing.')
}

async function send(page: Page, name = hello.send) {
  await page.getByRole('button', { name }).click()
}

/** Answers each send with the next reply in the list, and records the bodies. */
async function mockHello(page: Page, ...replies: { status: number; body?: unknown }[]) {
  const bodies: Record<string, unknown>[] = []
  await page.route('**/api/hello', async (route) => {
    bodies.push(route.request().postDataJSON())
    const reply = replies[Math.min(bodies.length, replies.length) - 1]!
    await route.fulfill({ status: reply.status, json: reply.body ?? null })
  })
  return bodies
}

function failedBox(page: Page) {
  return page.locator('.send-failed')
}

test.describe('say hello', () => {
  test('has the form, with no extra fields', async ({ page }) => {
    await open(page)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(hello.title)
    await expect(page).toHaveTitle(`${hello.page_title} – ${en.site.name}`)
    const form = page.locator('form.hello__form')
    await expect(form.getByRole('textbox')).toHaveCount(3)
    await expect(form.getByRole('checkbox')).toHaveCount(0)
    await expect(page.getByText(hello.kept.body)).toBeVisible()
    await expect(page.getByText(hello.danger.body)).toBeVisible()
    await expect(page.getByText(en.forms.turnstile.notice)).toBeVisible()
  })

  test('checks the fields before sending, and sends nothing', async ({ page }) => {
    const bodies = await mockHello(page, { status: 201, body: { ok: true } })
    await open(page)
    await page.getByLabel(hello.email.label).fill('test@example')
    await send(page)

    const summary = page.locator('.error-summary')
    await expect(summary).toBeFocused()
    await expect(page).toHaveTitle(/^Error: Say hello/)
    await expect(summary.getByRole('link')).toHaveText([
      `${hello.fields.callName}: ${hello.errors.callName.required}`,
      `${hello.fields.email}: ${hello.errors.email.invalid_email.replace("{'@'}", '@')}`,
      `${hello.fields.message}: ${hello.errors.message.required}`,
    ])
    await summary.getByRole('link').nth(2).click()
    await expect(page.getByLabel(hello.message.label, { exact: true })).toBeFocused()
    await expect(page.getByLabel(hello.email.label)).toHaveAttribute('aria-invalid', 'true')
    expect(bodies).toEqual([])
  })

  test('sends the message and says thank you', async ({ page }) => {
    const bodies = await mockHello(page, {
      status: 201,
      body: { ok: true, receipt: 'not_requested' },
    })
    await open(page)
    await fillIn(page)
    await send(page)

    const heading = page.getByRole('heading', { name: SENT_TITLE })
    await expect(heading).toBeFocused()
    await expect(page).toHaveTitle(`${hello.sent.page_title} – ${en.site.name}`)
    await expect(page.getByText(hello.sent.body)).toBeVisible()
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({
      callName: 'Test Organiser',
      email: 'test.organiser@example.com',
      message: 'A made-up message for testing.',
    })
    expect(bodies[0]!.submissionId).toMatch(/^[0-9a-f-]{36}$/)
    expect(String(bodies[0]!.turnstileToken)).not.toBe('')

    // Another message starts empty, with a new id.
    await page.getByRole('button', { name: hello.sent.again }).click()
    await expect(page.getByRole('heading', { name: hello.form_title })).toBeFocused()
    await expect(page.getByLabel(hello.callName.label)).toHaveValue('')
  })

  test('shows an error the server found on its field', async ({ page }) => {
    await mockHello(page, {
      status: 422,
      body: { ok: false, errors: [{ field: 'message', code: 'too_long' }] },
    })
    await open(page)
    await fillIn(page)
    await send(page)
    await expect(page.locator('.error-summary').getByRole('link')).toHaveText([
      `${hello.fields.message}: ${hello.errors.message.too_long.replace('{max}', '2000')}`,
    ])
  })

  test('asks to try again when the spam check is refused, with the same id', async ({ page }) => {
    const bodies = await mockHello(
      page,
      {
        status: 403,
        body: { ok: false, errors: [{ field: 'turnstileToken', code: 'turnstile_failed' }] },
      },
      { status: 200, body: { ok: true, receipt: 'not_requested' } },
    )
    await open(page)
    await fillIn(page)
    await send(page)

    const summary = page.locator('.error-summary')
    await expect(summary).toBeFocused()
    await expect(summary.getByRole('link')).toHaveText([
      `${hello.fields.spam_check}: ${en.forms.turnstile.failed}`,
    ])
    await summary.getByRole('link').click()
    await expect(page.getByRole('button', { name: hello.send })).toBeFocused()

    await send(page)
    await expect(page.getByRole('heading', { name: SENT_TITLE })).toBeVisible()
    expect(bodies[1]!.submissionId).toBe(bodies[0]!.submissionId)
  })

  for (const [name, reply, text] of [
    [
      'too many tries',
      { status: 429, body: { ok: false, error: 'rate_limited', retryAfter: 60 } },
      hello.failed.rate_limited,
    ],
    [
      'a server error',
      { status: 500, body: { ok: false, error: 'unavailable' } },
      hello.failed.unavailable,
    ],
    ['a body that was too big', { status: 413 }, hello.failed.unavailable],
  ] as const) {
    test(`keeps what was typed after ${name}`, async ({ page }) => {
      await mockHello(page, reply)
      await open(page)
      await fillIn(page)
      await send(page)
      await expect(failedBox(page)).toBeFocused()
      await expect(failedBox(page)).toContainText(text)
      await expect(page.getByLabel(hello.message.label, { exact: true })).toHaveValue(
        'A made-up message for testing.',
      )
      await expect(page.getByRole('button', { name: hello.send_again })).toBeVisible()
      // Say hello is where they are, so it isn't offered as somewhere else to try.
      await expect(failedBox(page).getByRole('link')).toHaveCount(0)
    })
  }

  test('copies the message, and confirms it', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await mockHello(page, { status: 500 })
    await open(page)
    await fillIn(page)
    await send(page)
    await page.getByRole('button', { name: hello.failed.copy }).click()
    await expect(failedBox(page).getByRole('status')).toHaveText(hello.failed.copied)
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied).toContain('A made-up message for testing.')
  })

  test("says the spam check couldn't load, and sends nothing", async ({ page }) => {
    const sends: Request[] = []
    page.on('request', (request) => {
      if (request.method() === 'POST') sends.push(request)
    })
    await page.route(`${TURNSTILE_ORIGIN}/**`, (route) => route.abort('blockedbyclient'))
    await page.goto('/say-hello')
    await expect(page.getByText(en.forms.turnstile.unavailable)).toBeVisible()
    await fillIn(page)
    await send(page)
    await expect(failedBox(page)).toBeFocused()
    await expect(failedBox(page)).toContainText(hello.failed.spam_check)
    expect(sends).toEqual([])
  })

  test('the sent message and the failed box have no automatically detectable WCAG 2.2 AA failures', async ({
    page,
  }) => {
    await mockHello(page, { status: 500 }, { status: 201, body: { ok: true } })
    await open(page)
    await fillIn(page)
    const scan = async () => {
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations.map((violation) => violation.id)).toEqual([])
    }
    await send(page)
    await expect(failedBox(page)).toBeVisible()
    await scan()
    await send(page, hello.send_again)
    await expect(page.getByRole('heading', { name: SENT_TITLE })).toBeVisible()
    await scan()
  })
})

test.describe('say hello without JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('says the form needs JavaScript (Rowan, F)', async ({ page }) => {
    await page.goto('/say-hello')
    // Playwright's text locators skip <noscript>, so check the rendered box.
    const shown = await page.evaluate(() => {
      const note = document.querySelector('.hello__noscript')
      return note
        ? { text: note.textContent?.trim(), height: note.getBoundingClientRect().height }
        : null
    })
    expect(shown?.text).toBe(hello.noscript)
    expect(shown?.height).toBeGreaterThan(0)
  })
})
