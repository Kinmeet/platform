import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The accessibility statement (#145) is a 404 until it's published, so the
// end-to-end tests can't load it yet. This mounts it with the flag on, to
// check what the founder's review will see. Made-up address only.
const page = vi.hoisted(() => ({
  path: '/accessibility',
  published: true,
  lastReviewed: null as string | null,
  address: null as string | null,
}))
vi.mock('../../../shared/pages/accessibility', () => ({ accessibilityPage: page }))

const { default: AccessibilityPage } = await import('../../../app/pages/accessibility.vue')

let wrappers: { unmount: () => void }[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  page.lastReviewed = null
  page.address = null
})

async function mount() {
  const wrapper = await mountSuspended(AccessibilityPage)
  wrappers.push(wrapper)
  return wrapper
}

function copy(key: string, params?: Record<string, string>): string {
  const text = useNuxtApp().$i18n.t(key, params ?? {})
  expect(text, `${key} is missing`).not.toBe(key)
  return text
}

describe('accessibility statement', () => {
  it('has one main heading and states the WCAG 2.2 AA target', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('h1').map((h) => h.text())).toEqual([copy('accessibility.title')])
    expect(wrapper.text()).toContain(copy('accessibility.aim.body'))
    expect(copy('accessibility.aim.body')).toContain('WCAG) 2.2 at level AA')
  })

  it('lists what the target means as a real list', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual(
      ['keyboard', 'zoom', 'screen_reader', 'motion', 'plain_english'].map((aim) =>
        copy(`accessibility.aim.${aim}`),
      ),
    )
  })

  it('leaves out the gaps: the date, the known problems and the address', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(
      ['aim', 'report', 'test'].map((part) => copy(`accessibility.${part}.heading`)),
    )
    const text = wrapper.text()
    expect(text).not.toContain('Last reviewed')
    expect(text).not.toContain('{address}')
    expect(text).toContain(copy('accessibility.report.then'))
  })

  it('shows the date, the address and the meets part once they are set', async () => {
    page.lastReviewed = '2026-10-28'
    page.address = 'hello@example.org'
    const wrapper = await mount()
    const text = wrapper.text()
    expect(text).toContain(copy('accessibility.last_reviewed', { date: '28 October 2026' }))
    expect(text).toContain(copy('accessibility.report.email', { address: 'hello@example.org' }))
    expect(text).toContain(copy('accessibility.meets.body', { address: 'hello@example.org' }))
    expect(wrapper.find('h2#meets').text()).toBe(copy('accessibility.meets.heading'))
  })
})
