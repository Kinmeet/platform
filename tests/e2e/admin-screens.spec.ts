import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { accessRoutes } from '../../shared/routes'
import { waitForApp, watchPage } from './helpers'

// The admin screens (#32, #160) behind Cloudflare Access. Locally every admin
// document and API request answers 403 (access-routes.spec.ts checks that),
// so these tests load a public page, answer the admin API with made-up data
// in the browser, and move to each admin screen inside the app. That draws
// the real pages with the real styles, so the WCAG scan, the 320px check and
// the no-third-party check run on them like on every public page. Made-up
// test data only.
const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const NOW = 1_793_000_000

const definition = {
  steps: [
    {
      id: 'checks',
      body: 'checks',
      fields: [
        {
          id: 'pick',
          type: 'single_choice',
          required: true,
          choices: ['yes', 'no'],
          outcomes: { no: { stop: 'under_18' } },
        },
      ],
    },
    {
      id: 'answers',
      body: 'answers',
      fields: [
        { id: 'why', type: 'long_text', required: true, maxLength: 1000 },
        { id: 'agree', type: 'confirm', required: true },
      ],
    },
  ],
  aboutYou: 1,
  note: false,
  receipt: 'application_receipt',
  actions: ['outcome_told', 'pass_to_safeguarding'],
  readers: ['secretary', 'safeguarding_lead', 'chair'],
}

const text = {
  title: 'Sample role',
  intro: 'A made-up introduction to a sample role.',
  'fields.pick.label': 'Are you 18 or over?',
  'fields.pick.summary': 'Over 18',
  'fields.pick.choices.yes': 'Yes',
  'fields.pick.choices.no': 'No',
  'fields.why.label': 'Why would you like this sample role?',
  'fields.why.summary': 'Why this role',
  'fields.agree.label': 'I have read the made-up rules.',
  'fields.agree.summary': 'Read the rules',
  'fields.agree.choices.yes': 'Yes, I have read them',
}

const summary = {
  id: 'form-1',
  slug: 'sample-role',
  kind: 'application',
  status: 'open',
  version: 1,
  p3Row: 'Trustee applications, stage 1',
  retentionMonths: 6,
  readers: ['secretary', 'safeguarding_lead', 'chair'],
  title: 'Sample role',
  hasDraft: true,
}

const content = { purpose: 'trustee_application', definition, text: { 'en-GB': text } }

const replies: Record<string, unknown> = {
  'GET /api/admin/forms': { forms: [summary] },
  'GET /api/admin/forms/form-1': {
    ok: true,
    form: summary,
    current: { ...content, version: 1, publishedAt: NOW },
    draft: { ...content, updatedAt: NOW },
    versions: [{ version: 1, publishedAt: NOW }],
  },
  'GET /api/admin/forms/form-1/check': {
    ok: true,
    check: {
      ok: false,
      problems: [{ code: 'us_spelling', path: 'text.en-GB.fields.why.label' }],
      needsSecondApproval: false,
    },
    preview: {
      slug: 'sample-role',
      kind: 'application',
      version: 2,
      definition: { steps: definition.steps, aboutYou: 1, note: false },
      text,
      safetyNote: true,
    },
  },
  'GET /api/admin/forms/form-1/submissions': {
    ok: true,
    submissions: [
      {
        id: 'sub-1',
        version: 1,
        callName: 'Test Otter',
        email: 'test.otter@example.org',
        answers: [{ id: 'why', label: 'Why would you like this sample role?', text: 'Made-up.' }],
        receivedAt: NOW,
        repliedAt: null,
        outcomeToldAt: null,
        deleteAfter: NOW + 1000,
        actions: ['outcome_told', 'pass_to_safeguarding'],
      },
    ],
  },
  'GET /api/admin/messages': { messages: [] },
  'GET /api/admin/applications': { applications: [] },
}

/** Answers the admin API in the browser; anything unexpected fails the test. */
async function mockAdminApi(page: Page) {
  const unexpected: string[] = []
  await page.route('**/api/admin/**', async (route) => {
    const request = route.request()
    const key = `${request.method()} ${new URL(request.url()).pathname}`
    if (key in replies) return route.fulfill({ json: replies[key] })
    unexpected.push(key)
    return route.fulfill({ status: 500, json: { ok: false, error: 'unavailable' } })
  })
  return { unexpected: () => unexpected }
}

/** Opens an admin screen from the home page, without a new document. */
async function openInApp(page: Page, path: string) {
  await page.goto('/')
  await waitForApp(page)
  await page.evaluate(async (to) => {
    const app = (
      document.querySelector('#__nuxt') as unknown as {
        __vue_app__: {
          config: { globalProperties: { $router: { push: (to: string) => Promise<void> } } }
        }
      }
    ).__vue_app__
    await app.config.globalProperties.$router.push(to)
  }, path)
  await expect(page).toHaveURL(new RegExp(`${path}$`))
  await expect(page.locator('main.admin h1')).toBeVisible()
  await expect(page.getByText('Loading…')).toHaveCount(0)
}

const screens = [
  { path: '/admin', heading: 'Admin' },
  { path: '/admin/forms', heading: 'Forms' },
  { path: '/admin/forms/form-1', heading: 'Form builder: Sample role' },
  { path: '/admin/forms/form-1/publish', heading: 'Publish: Sample role' },
  { path: '/admin/forms/form-1/submissions', heading: 'Submissions: Sample role' },
]

test('every admin screen with a fixed address is behind Access', () => {
  for (const screen of screens) {
    const fixed = !screen.path.includes('form-1')
    if (fixed) expect(accessRoutes).toContain(screen.path)
  }
})

for (const screen of screens) {
  test(`${screen.path} has no automatically detectable WCAG 2.2 AA failures`, async ({
    page,
    baseURL,
  }) => {
    const ownOrigin = new URL(baseURL!).origin
    const problems = await watchPage(page, new Set([ownOrigin]), ownOrigin)
    // Registered after watchPage's own route, so it answers first.
    const api = await mockAdminApi(page)
    await openInApp(page, screen.path)
    await expect(page.locator('main.admin h1')).toHaveText(screen.heading)

    const results = await new AxeBuilder({ page })
      .include('main.admin')
      .withTags(WCAG_TAGS)
      .analyze()
    const failures = results.violations.map((violation) => ({
      rule: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))
    expect(failures).toEqual([])
    expect(api.unexpected()).toEqual([])
    expect.soft(problems.thirdPartyRequests, 'requests to other origins').toEqual([])
    expect.soft(problems.cspViolations, 'content security policy violations').toEqual([])
    expect.soft(problems.pageErrors, 'script errors').toEqual([])
  })

  test(`${screen.path} fits a 320px screen without scrolling sideways`, async ({ page }) => {
    const api = await mockAdminApi(page)
    await page.setViewportSize({ width: 320, height: 640 })
    await openInApp(page, screen.path)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
    expect(api.unexpected()).toEqual([])
  })
}

// The editing panel changes with the answer type, so each kind is scanned open.
for (const field of ['pick', 'why', 'agree']) {
  test(`the builder's editing panel for "${field}" has no detectable WCAG 2.2 AA failures`, async ({
    page,
  }) => {
    const api = await mockAdminApi(page)
    await openInApp(page, '/admin/forms/form-1')
    await page.locator(`#edit-${field}`).click()
    await expect(page.locator('#editor-heading')).toBeFocused()
    const results = await new AxeBuilder({ page })
      .include('main.admin')
      .withTags(WCAG_TAGS)
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    expect(api.unexpected()).toEqual([])
  })
}
