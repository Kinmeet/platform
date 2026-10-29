import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineEventHandler, readBody, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import FormsPage from '../../../app/pages/admin/forms/index.vue'
import BuilderPage from '../../../app/pages/admin/forms/[id]/index.vue'
import PublishPage from '../../../app/pages/admin/forms/[id]/publish.vue'
import SubmissionsPage from '../../../app/pages/admin/forms/[id]/submissions.vue'
import type {
  AdminFormCheck,
  AdminFormDetail,
  AdminFormSummary,
  AdminSubmission,
} from '../../../shared/admin'
import type { FormDefinition } from '../../../shared/forms/definition'
import type { PublicForm } from '../../../shared/forms/view'

// The form builder's admin pages (ADR-0010, B3, #160), mounted with mocked
// API replies so focus, announcements and every reply the API can give can
// be checked without Cloudflare Access. Made-up test data only.
const NOW = 1_793_000_000

const definition: FormDefinition = {
  steps: [
    {
      id: 'questions',
      body: null,
      fields: [
        {
          id: 'pick',
          type: 'single_choice',
          required: true,
          choices: ['yes', 'no'],
        },
        {
          id: 'more',
          type: 'long_text',
          required: false,
          maxLength: 500,
          showIf: { field: 'pick', in: ['yes'] },
        },
        { id: 'extra', type: 'short_text', required: true, maxLength: 100 },
      ],
    },
  ],
  aboutYou: 0,
  note: false,
  receipt: 'none',
  actions: ['reply', 'pass_to_safeguarding'],
  readers: ['central_team', 'secretary'],
}

const text: Record<string, string> = {
  title: 'Sample form',
  intro: 'A made-up introduction.',
  'fields.pick.label': 'Do you like the sample?',
  'fields.pick.summary': 'Likes the sample',
  'fields.pick.choices.yes': 'Yes',
  'fields.pick.choices.no': 'No',
  'fields.more.label': 'Tell us more about the sample',
  'fields.more.summary': 'More about it',
  'fields.extra.label': 'A made-up extra question',
  'fields.extra.summary': 'Extra question',
}

const summary: AdminFormSummary = {
  id: 'form-1',
  slug: 'sample',
  kind: 'form',
  status: 'open',
  version: 2,
  p3Row: 'Say hello messages',
  retentionMonths: 12,
  readers: ['central_team', 'secretary'],
  title: 'Sample form',
  hasDraft: true,
}

let saved: unknown
let check: AdminFormCheck
let publishReply: { status: number; body: Record<string, unknown> }
let submissions: AdminSubmission[]
let wrappers: { unmount: () => void }[] = []

beforeEach(() => {
  saved = undefined
  check = {
    ok: false,
    problems: [
      { code: 'us_spelling', path: 'text.en-GB.fields.extra.label' },
      { code: 'text_missing', path: 'text.en-GB.title' },
      { code: 'made_up_code', path: 'definition' },
    ],
    needsSecondApproval: false,
  }
  publishReply = { status: 200, body: { ok: true, version: 3 } }
  submissions = [
    {
      id: 'sub-1',
      version: 2,
      callName: 'Test Badger',
      email: 'test.badger@example.com',
      answers: [
        { id: 'pick', label: 'Do you like the sample?', text: 'Yes' },
        { id: 'more', label: 'Tell us more about the sample', text: '<b>Made-up</b> answer.' },
      ],
      receivedAt: NOW,
      repliedAt: null,
      outcomeToldAt: null,
      deleteAfter: NOW + 1000,
      actions: ['reply', 'pass_to_safeguarding'],
    },
  ]
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

const detail = (): { ok: true } & AdminFormDetail => ({
  ok: true,
  form: summary,
  current: {
    purpose: 'say_hello',
    definition,
    text: { 'en-GB': text },
    version: 2,
    publishedAt: NOW,
  },
  draft: {
    purpose: 'say_hello',
    definition: structuredClone(definition),
    text: { 'en-GB': { ...text } },
    updatedAt: NOW,
  },
  versions: [{ version: 2, publishedAt: NOW }],
})

const preview = (): PublicForm => ({
  slug: 'sample',
  kind: 'form',
  version: 3,
  definition: { steps: definition.steps, aboutYou: 0, note: false },
  text,
  safetyNote: true,
})

registerEndpoint('/api/admin/forms', {
  method: 'GET',
  handler: defineEventHandler(() => ({ forms: [summary] })),
})
registerEndpoint('/api/admin/forms', {
  method: 'POST',
  handler: defineEventHandler((event) => {
    setResponseStatus(event, 409)
    return { ok: false, error: 'slug_taken' }
  }),
})
registerEndpoint('/api/admin/forms/form-1', {
  method: 'GET',
  handler: defineEventHandler(() => detail()),
})
registerEndpoint('/api/admin/forms/form-1/check', {
  method: 'GET',
  handler: defineEventHandler(() => ({ ok: true, check, preview: preview() })),
})
registerEndpoint('/api/admin/forms/form-1/draft', {
  method: 'PUT',
  handler: defineEventHandler(async (event) => {
    saved = await readBody(event)
    return { ok: true, check }
  }),
})
registerEndpoint('/api/admin/forms/form-1/publish', {
  method: 'POST',
  handler: defineEventHandler((event) => {
    setResponseStatus(event, publishReply.status)
    return publishReply.body
  }),
})
registerEndpoint('/api/admin/forms/form-1/submissions', {
  method: 'GET',
  handler: defineEventHandler(() => ({ ok: true, submissions })),
})
registerEndpoint('/api/admin/submissions/sub-1/replied', {
  method: 'POST',
  handler: defineEventHandler(() => {
    submissions = submissions.map((each) => ({ ...each, repliedAt: NOW + 10 }))
    return { ok: true }
  }),
})
registerEndpoint('/api/admin/submissions/sub-1/safeguarding', {
  method: 'POST',
  handler: defineEventHandler(() => {
    submissions = []
    return { ok: true }
  }),
})

async function mount(page: Parameters<typeof mountSuspended>[0], route: string) {
  const wrapper = await mountSuspended(page, { route, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.text()).not.toContain('Loading'))
  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mount>>

const buttonNamed = (wrapper: Wrapper, text: string) => {
  const button = wrapper.findAll('button').find((each) => each.text().startsWith(text))
  if (!button) throw new Error(`no button "${text}"`)
  return button
}

const status = (wrapper: Wrapper) => wrapper.find('.admin__status').text()

/** The builder, once its saved draft's checks and preview have loaded. */
async function mountBuilder() {
  const wrapper = await mount(BuilderPage, '/admin/forms/form-1')
  await vi.waitFor(() => expect(wrapper.find('.admin-checks').exists()).toBe(true))
  return wrapper
}

describe('forms list', () => {
  it('lists each form with its kind, status, retention and readers', async () => {
    const wrapper = await mount(FormsPage, '/admin/forms')
    expect(wrapper.find('h1').text()).toBe('Forms')
    const row = wrapper.find('tbody tr')
    expect(row.find('th a').text()).toBe('Sample form')
    expect(row.find('th a').attributes('href')).toBe('/admin/forms/form-1')
    expect(row.text()).toContain('Message form')
    expect(row.text()).toContain('Open')
    expect(row.text()).toContain('Version 2')
    expect(row.text()).toContain('12 months after our last reply (P3: Say hello messages)')
    expect(row.text()).toContain('Central team and Secretary')
    // The current page is marked in the admin links.
    expect(wrapper.find('nav a[aria-current="page"]').text()).toBe('Forms')
  })

  it('says why a new form was refused, and moves focus to it', async () => {
    const wrapper = await mount(FormsPage, '/admin/forms')
    await wrapper.find('#new-form-slug').setValue('sample')
    await wrapper.find('form').trigger('submit')
    await vi.waitFor(() => expect(wrapper.find('[role="alert"]').exists()).toBe(true))
    const alert = wrapper.find('[role="alert"]')
    expect(alert.text()).toContain('Another form already uses that web address name.')
    expect(document.activeElement).toBe(alert.element)
  })
})

describe('form builder', () => {
  it('shows the steps and questions, the settings and the saved checks', async () => {
    const wrapper = await mountBuilder()
    expect(wrapper.find('h1').text()).toBe('Form builder: Sample form')
    const questions = wrapper.findAll('.admin-question__name').map((each) => each.text())
    expect(questions).toEqual([
      'Do you like the sample?',
      'Tell us more about the sample',
      'A made-up extra question',
    ])
    expect(wrapper.text()).toContain('Long text. Optional.')
    expect(wrapper.text()).toContain('Shown only for some answers to "Do you like the sample?".')
    // Every Edit and Move button names its question for screen readers.
    expect(buttonNamed(wrapper, 'Edit').text()).toBe('Edit Do you like the sample?')
    expect(wrapper.find('#settings-purpose').element).toHaveProperty('value', 'say_hello')
    expect(wrapper.text()).toContain('There are 3 things to fix')
  })

  it('words each problem from our own text, naming what it is about', async () => {
    const wrapper = await mountBuilder()
    const items = wrapper.findAll('.admin-checks li a')
    expect(items.map((each) => each.text())).toEqual([
      'Question "A made-up extra question": This wording uses an American spelling. Use the British English spelling.',
      'Form title: This needs wording. Write it before publishing.',
      'Form settings: Something else needs fixing (code made_up_code). Ask the developer what it means.',
    ])
    expect(items.map((each) => each.attributes('href'))).toEqual([
      '#edit-extra',
      '#text-title',
      '#settings-heading',
    ])
    await items[1]!.trigger('click')
    expect(document.activeElement?.id).toBe('text-title')
  })

  it('moves focus to the editing panel on Edit, and back on Done', async () => {
    const wrapper = await mountBuilder()
    await wrapper.find('#edit-extra').trigger('click')
    await flushPromises()
    expect(document.activeElement?.id).toBe('editor-heading')
    expect(wrapper.find('#editor-heading').text()).toBe('Editing: A made-up extra question')
    // Admins see the fixed error wording, never write it.
    const errors = wrapper.findAll('.admin-editor__errors li').map((each) => each.text())
    expect(errors).toHaveLength(2)
    expect(wrapper.find('.admin-editor__errors').text()).toContain('Extra question: ')
    await buttonNamed(wrapper, 'Done').trigger('click')
    await flushPromises()
    expect(document.activeElement?.id).toBe('edit-extra')
  })

  it('keeps focus on Move and announces the new position', async () => {
    const wrapper = await mountBuilder()
    const down = buttonNamed(wrapper, 'Move down Tell us more about the sample')
    ;(down.element as HTMLElement).focus()
    await down.trigger('click')
    await flushPromises()
    expect(status(wrapper)).toBe(
      '"Tell us more about the sample" is now question 3 of 3 in step 1.',
    )
    expect(document.activeElement).toBe(down.element)
    expect(wrapper.findAll('.admin-question__name').map((each) => each.text())[2]).toBe(
      'Tell us more about the sample',
    )
    // The first question can't move up: the button says so and does nothing.
    const up = buttonNamed(wrapper, 'Move up Do you like the sample?')
    expect(up.attributes('aria-disabled')).toBe('true')
  })

  it('saves the draft with only the words its questions use', async () => {
    const wrapper = await mountBuilder()
    await wrapper.find('#edit-extra').trigger('click')
    await flushPromises()
    await buttonNamed(wrapper, 'Remove this question').trigger('click')
    await flushPromises()
    expect(status(wrapper)).toBe('Removed "A made-up extra question".')
    expect(document.activeElement?.id).toBe('step-1')
    expect(wrapper.text()).toContain("You have changes that aren't saved.")

    await buttonNamed(wrapper, 'Save draft').trigger('click')
    await vi.waitFor(() => expect(saved).toBeDefined())
    const body = saved as { purpose: string; definition: FormDefinition; text: unknown }
    expect(body.purpose).toBe('say_hello')
    expect(body.definition.steps[0]!.fields.map((field) => field.id)).toEqual(['pick', 'more'])
    const words = (body.text as Record<string, Record<string, string>>)['en-GB']!
    expect(Object.keys(words)).not.toContain('fields.extra.label')
    expect(words['fields.pick.label']).toBe('Do you like the sample?')
    await vi.waitFor(() =>
      expect(status(wrapper)).toBe('Draft saved. There are 3 things to fix before publishing.'),
    )
  })

  it('previews the draft with the public field renderer, sending nothing', async () => {
    const wrapper = await mountBuilder()
    const preview = wrapper.find('.admin-preview')
    expect(preview.find('h3').text()).toBe('Sample form')
    expect(preview.find('form').exists()).toBe(false)
    expect(preview.find('legend').text()).toBe('Do you like the sample?')
    // The question shown only for "Yes" appears once it is picked.
    expect(preview.text()).not.toContain('Tell us more about the sample')
    await preview.find('input[type="radio"][value="yes"]').setValue(true)
    expect(preview.text()).toContain('Tell us more about the sample')
    // A free-text form shows where a worry goes (SG6).
    expect(preview.find('.form-safety-note').exists()).toBe(true)
  })

  it('opens Publish only when every check is done and nothing is unsaved', async () => {
    const wrapper = await mountBuilder()
    const publish = buttonNamed(wrapper, 'Publish')
    expect(publish.attributes('aria-disabled')).toBe('true')
    await publish.trigger('click')
    await flushPromises()
    expect((document.activeElement as HTMLElement).classList).toContain('admin-checks')

    check = { ok: true, problems: [], needsSecondApproval: false }
    const ready = await mountBuilder()
    const link = ready
      .findAll('a')
      .find((each) => each.text() === 'Publish' && each.classes('button'))
    expect(link?.attributes('href')).toBe('/admin/forms/form-1/publish')
  })
})

describe('publish page', () => {
  it('publishes and says which version went live', async () => {
    check = { ok: true, problems: [], needsSecondApproval: false }
    const wrapper = await mount(PublishPage, '/admin/forms/form-1/publish')
    expect(wrapper.find('h1').text()).toBe('Publish: Sample form')
    await buttonNamed(wrapper, 'Publish version 3').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('#outcome-heading').exists()).toBe(true))
    expect(wrapper.find('#outcome-heading').text()).toBe('Published')
    expect(wrapper.text()).toContain('Version 3 is published.')
    expect(document.activeElement).toBe(wrapper.find('.admin-outcome').element)
  })

  it('asks for a fresh sign-in with a link that reloads the page', async () => {
    check = { ok: true, problems: [], needsSecondApproval: false }
    publishReply = { status: 403, body: { ok: false, error: 'reauth_required' } }
    const wrapper = await mount(PublishPage, '/admin/forms/form-1/publish')
    await buttonNamed(wrapper, 'Publish version 3').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('#outcome-heading').exists()).toBe(true))
    expect(wrapper.find('#outcome-heading').text()).toBe('Sign in again to publish')
    expect(wrapper.text()).toContain('Nothing was published.')
    const reload = wrapper.findAll('.admin-outcome a').find((a) => a.text() === 'Reload this page')
    expect(reload?.attributes('href')).toBe('/admin/forms/form-1/publish')
  })

  it.each([
    [403, { ok: false, error: 'forbidden' }, "You can't publish here"],
    [409, { ok: false, error: 'changed' }, 'Someone else published first'],
    [404, { ok: false, error: 'no_draft' }, 'No draft to publish'],
    [500, { ok: false, error: 'unavailable' }, 'That did not work'],
  ])('shows a %s reply plainly', async (code, body, heading) => {
    check = { ok: true, problems: [], needsSecondApproval: false }
    publishReply = { status: code, body }
    const wrapper = await mount(PublishPage, '/admin/forms/form-1/publish')
    await buttonNamed(wrapper, 'Publish version 3').trigger('click')
    await vi.waitFor(() => expect(wrapper.find('#outcome-heading').text()).toBe(heading))
    // Anything that might be a lapsed sign-in offers a reload, which signs in again.
    const reload = wrapper.findAll('.admin-outcome a').some((a) => a.text() === 'Reload this page')
    expect(reload).toBe(code === 409 || code === 500)
  })

  it('shows the checks the server found when they fail on publish', async () => {
    check = { ok: true, problems: [], needsSecondApproval: false }
    publishReply = {
      status: 422,
      body: {
        ok: false,
        error: 'checks_failed',
        check: {
          ok: false,
          problems: [{ code: 'second_approval_needed', path: 'definition' }],
          needsSecondApproval: true,
        },
      },
    }
    const wrapper = await mount(PublishPage, '/admin/forms/form-1/publish')
    await buttonNamed(wrapper, 'Publish version 3').trigger('click')
    await vi.waitFor(() =>
      expect(wrapper.find('#outcome-heading').text()).toBe('Some checks failed'),
    )
    expect(wrapper.text()).toContain('This change needs a second person to approve it')
    // Each problem links back to the builder, where it can be fixed.
    expect(wrapper.find('.admin-checks a').attributes('href')).toBe(
      '/admin/forms/form-1#settings-heading',
    )
  })

  it("won't publish while a check fails", async () => {
    const wrapper = await mount(PublishPage, '/admin/forms/form-1/publish')
    const button = buttonNamed(wrapper, 'Publish version 3')
    expect(button.attributes('aria-disabled')).toBe('true')
    await button.trigger('click')
    await flushPromises()
    expect(wrapper.find('#outcome-heading').exists()).toBe(false)
  })
})

describe('submissions page', () => {
  it('lists answers as plain text, labelled by their own version', async () => {
    const wrapper = await mount(SubmissionsPage, '/admin/forms/form-1/submissions')
    expect(wrapper.find('h1').text()).toBe('Submissions: Sample form')
    expect(wrapper.find('h3').text()).toBe('Test Badger')
    expect(wrapper.text()).toContain('Tell us more about the sample')
    // Sender text is never drawn as markup.
    expect(wrapper.find('.admin__answers b').exists()).toBe(false)
    expect(wrapper.text()).toContain('<b>Made-up</b> answer.')
    // Only the actions the version allows are offered.
    expect(wrapper.text()).toContain('Mark replied')
    expect(wrapper.text()).not.toContain('Mark outcome told')
  })

  it('records a reply, announces it and keeps focus on the submission', async () => {
    const wrapper = await mount(SubmissionsPage, '/admin/forms/form-1/submissions')
    await buttonNamed(wrapper, 'Mark replied').trigger('click')
    await vi.waitFor(() => expect(status(wrapper)).not.toBe(''))
    await flushPromises()
    expect(status(wrapper)).toContain('Marked as replied to Test Badger.')
    expect(document.activeElement?.id).toBe('submission-sub-1')
  })

  it('passes a submission to safeguarding and moves focus to the list', async () => {
    const wrapper = await mount(SubmissionsPage, '/admin/forms/form-1/submissions')
    await buttonNamed(wrapper, 'Pass to safeguarding').trigger('click')
    await flushPromises()
    await buttonNamed(wrapper, 'Yes, pass it to safeguarding').trigger('click')
    await vi.waitFor(() => expect(status(wrapper)).not.toBe(''))
    await flushPromises()
    expect(status(wrapper)).toBe('Passed to safeguarding. Now tell the safeguarding lead.')
    expect(wrapper.text()).toContain('Nothing has been sent through this form.')
    expect(document.activeElement?.id).toBe('submissions-heading')
  })
})
