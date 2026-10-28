import { flushPromises } from '@vue/test-utils'
import { mountSuspended, registerEndpoint } from '@nuxt/test-utils/runtime'
import { defineEventHandler, setResponseStatus } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AdminPage from '../../../app/pages/admin/index.vue'
import type { AdminApplication, AdminHelloMessage } from '../../../shared/admin'

// Mounts the admin page with mocked API data, so focus and announcements can
// be checked without Cloudflare Access (#32, Robin's review of #51).
// Made-up test data only.
const RECEIVED = 1_793_000_000

let messages: AdminHelloMessage[]
let applications: AdminApplication[]
let failNextList = false
let wrappers: { unmount: () => void }[] = []

beforeEach(() => {
  failNextList = false
  messages = [
    {
      id: 'hello-1',
      callName: 'Test Fox',
      email: 'test.fox@example.com',
      message: 'Made-up message.',
      receivedAt: RECEIVED,
      repliedAt: null,
      deleteAfter: RECEIVED + 1000,
    },
  ]
  applications = [
    {
      id: 'application-1',
      role: 'trustee',
      callName: 'Test Hare',
      email: 'test.hare@example.com',
      answers: { why_trustee: 'Made-up answer.', removed_question: 'Old answer.' },
      labels: { why_trustee: 'A made-up question label' },
      conflictToDeclare: true,
      connectionToFounders: 'not_sure',
      receivedAt: RECEIVED,
      outcomeToldAt: null,
      deleteAfter: RECEIVED + 1000,
    },
  ]
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

registerEndpoint('/api/admin/messages', {
  method: 'GET',
  handler: defineEventHandler((event) => {
    if (failNextList) {
      setResponseStatus(event, 500)
      return { error: 'unavailable' }
    }
    return { messages }
  }),
})
registerEndpoint('/api/admin/applications', {
  method: 'GET',
  handler: defineEventHandler(() => ({ applications })),
})
registerEndpoint('/api/admin/hello/hello-1/replied', {
  method: 'POST',
  handler: defineEventHandler(() => {
    messages = messages.map((m) => ({ ...m, repliedAt: RECEIVED + 10 }))
    return { ok: true }
  }),
})
registerEndpoint('/api/admin/applications/application-1/outcome-told', {
  method: 'POST',
  handler: defineEventHandler(() => {
    applications = applications.map((a) => ({ ...a, outcomeToldAt: RECEIVED + 10 }))
    return { ok: true }
  }),
})

registerEndpoint('/api/admin/hello/hello-1/safeguarding', {
  method: 'POST',
  handler: defineEventHandler(() => {
    messages = messages.filter((m) => m.id !== 'hello-1')
    return { ok: true }
  }),
})

async function mountPage() {
  const wrapper = await mountSuspended(AdminPage, { attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

// Waits until the action has finished and the list has refreshed.
async function settled(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  await vi.waitFor(() => {
    expect(wrapper.find('[role="status"]').text()).not.toBe('')
  })
  await flushPromises()
}

const buttonNamed = (wrapper: Awaited<ReturnType<typeof mountPage>>, text: string) => {
  const button = wrapper.findAll('button').find((b) => b.text().startsWith(text))
  if (!button) throw new Error(`no button "${text}"`)
  return button
}

describe('admin page', () => {
  it('lists messages and applications with readable labels', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('h1').text()).toBe('Admin')
    expect(wrapper.findAll('h3').map((h) => h.text())).toEqual(['Test Fox', 'Test Hare'])
    expect(wrapper.text()).toContain('Conflict to declare')
    expect(wrapper.text()).toContain('Not sure')
    // Each answer is labelled from its own version's text (Theo, #159).
    expect(wrapper.text()).toContain('A made-up question label')
    // Ids without wording are shown as the id itself, never hidden.
    expect(wrapper.text()).toContain('removed_question')
  })

  it('keeps focus on the button after marking replied and announces it', async () => {
    const wrapper = await mountPage()
    const button = buttonNamed(wrapper, 'Mark replied')
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await settled(wrapper)
    expect(document.activeElement).toBe(buttonNamed(wrapper, 'Mark replied').element)
    expect(wrapper.find('[role="status"]').text()).toBe(
      'Marked as replied to Test Fox. The deletion date has moved on.',
    )
  })

  it('marks buttons aria-disabled, not disabled, while an action is running', async () => {
    const wrapper = await mountPage()
    const button = buttonNamed(wrapper, 'Mark replied')
    await button.trigger('click')
    expect(button.attributes('aria-disabled')).toBe('true')
    expect(button.attributes('disabled')).toBeUndefined()
    await settled(wrapper)
    expect(button.attributes('aria-disabled')).toBeUndefined()
  })

  it('moves focus to the heading once the outcome is told', async () => {
    const wrapper = await mountPage()
    const button = buttonNamed(wrapper, 'Mark outcome told')
    ;(button.element as HTMLButtonElement).focus()
    await button.trigger('click')
    await settled(wrapper)
    expect(wrapper.findAll('button').some((b) => b.text().startsWith('Mark outcome told'))).toBe(
      false,
    )
    expect(document.activeElement?.id).toBe('application-application-1')
  })

  it('says so when the list could not be refreshed after an action', async () => {
    const wrapper = await mountPage()
    failNextList = true
    await buttonNamed(wrapper, 'Mark replied').trigger('click')
    await settled(wrapper)
    expect(wrapper.find('[role="status"]').text()).toBe(
      'That was saved, but the list could not be refreshed. Please reload the page.',
    )
    // The list stays on the page, so focus has somewhere to stay.
    expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Test Fox')
  })

  it('asks once before passing to safeguarding, with the 999 and tell-the-lead reminders', async () => {
    const wrapper = await mountPage()
    const open = buttonNamed(wrapper, 'Pass to safeguarding')
    ;(open.element as HTMLButtonElement).focus()
    await open.trigger('click')
    await flushPromises()
    const panel = wrapper.find('[role="group"]')
    expect(document.activeElement).toBe(panel.element)
    expect(panel.text()).toContain('If anyone is in immediate danger, call 999 first.')
    expect(panel.text()).toContain('tell the safeguarding lead')
    expect(panel.text()).toContain('Do not reply to it, forward it, copy it, screenshot it')
    // Nothing has been sent yet.
    expect(wrapper.findAll('h3').map((h) => h.text())).toContain('Test Fox')
  })

  it('puts focus back on the button when cancelled', async () => {
    const wrapper = await mountPage()
    await buttonNamed(wrapper, 'Pass to safeguarding').trigger('click')
    await flushPromises()
    await buttonNamed(wrapper, 'Cancel').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
    expect(document.activeElement).toBe(buttonNamed(wrapper, 'Pass to safeguarding').element)
  })

  it('takes the message off the page, moves focus to the list heading and announces it', async () => {
    const wrapper = await mountPage()
    await buttonNamed(wrapper, 'Pass to safeguarding').trigger('click')
    await flushPromises()
    await buttonNamed(wrapper, 'Yes, pass it to safeguarding').trigger('click')
    await settled(wrapper)
    expect(wrapper.findAll('h3').map((h) => h.text())).not.toContain('Test Fox')
    expect(document.activeElement?.id).toBe('hello-heading')
    expect(wrapper.find('[role="status"]').text()).toBe(
      'Passed to safeguarding. Now tell the safeguarding lead.',
    )
  })

  it('offers no copy, export or forward control', async () => {
    const wrapper = await mountPage()
    await buttonNamed(wrapper, 'Pass to safeguarding').trigger('click')
    await flushPromises()
    const labels = wrapper.findAll('button, a').map((b) => b.text().toLowerCase())
    for (const word of ['copy', 'export', 'forward', 'download', 'print']) {
      expect(labels.some((label) => label.startsWith(word))).toBe(false)
    }
  })
})
