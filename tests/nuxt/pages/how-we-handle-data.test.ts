import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'

// The privacy notice (#144) is a 404 until it's published, so the end-to-end
// tests can't load it yet. This mounts it with the flag on, to check what the
// founder's review will see and what a reader gets once it's live. Made-up
// address only.
const page = vi.hoisted(() => ({
  path: '/how-we-handle-data',
  published: true,
  lastUpdated: null as string | null,
  address: null as string | null,
}))
vi.mock('../../../shared/pages/privacy', () => ({ privacyPage: page }))

const { default: PrivacyPage } = await import('../../../app/pages/how-we-handle-data.vue')

let wrappers: { unmount: () => void }[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  page.lastUpdated = null
  page.address = null
})

async function mount() {
  const wrapper = await mountSuspended(PrivacyPage)
  wrappers.push(wrapper)
  return wrapper
}

function copy(key: string, params?: Record<string, string>): string {
  const text = useNuxtApp().$i18n.t(key, params ?? {})
  expect(text, `${key} is missing`).not.toBe(key)
  return text
}

describe('privacy notice', () => {
  it('has one main heading and a heading for each part', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('h1').map((h) => h.text())).toEqual([copy('privacy.title')])
    expect(wrapper.findAll('h2').map((h) => h.text())).toEqual(
      [
        'controller',
        'collect',
        'never',
        'why',
        'others',
        'keep',
        'rights',
        'under_18',
        'changes',
      ].map((part) => copy(`privacy.${part}.heading`)),
    )
  })

  it('lets a reader jump to what we collect, how long we keep it and their rights', async () => {
    const wrapper = await mount()
    for (const [id, part] of [
      ['what-we-collect', 'collect'],
      ['how-long-we-keep-it', 'keep'],
      ['your-rights', 'rights'],
    ]) {
      expect(wrapper.find(`h2#${id}`).text()).toBe(copy(`privacy.${part}.heading`))
    }
  })

  it('names the founder by role only', async () => {
    const wrapper = await mount()
    expect(wrapper.text()).toContain(copy('privacy.controller.not_yet'))
  })

  it('leaves out the contact sentences and the date while they are gaps', async () => {
    const wrapper = await mount()
    const text = wrapper.text()
    expect(text).not.toContain('{address}')
    expect(text).not.toContain('{date}')
    expect(text).not.toContain('Last updated')
    expect(text).not.toContain('Email ')
    expect(text).not.toContain('You can contact us at')
  })

  it('shows the contact address and the date once they are set', async () => {
    page.address = 'privacy@example.org'
    page.lastUpdated = '2026-10-28'
    const wrapper = await mount()
    const text = wrapper.text()
    expect(text).toContain(copy('privacy.last_updated', { date: '28 October 2026' }))
    expect(text).toContain(copy('privacy.controller.contact', { address: 'privacy@example.org' }))
    expect(text).toContain(copy('privacy.rights.email', { address: 'privacy@example.org' }))
  })

  it('shows each proposed P9 edit in its place, marked as a draft', async () => {
    const wrapper = await mount()
    const drafts = wrapper.findAll('.privacy-draft').map((node) => node.text())
    expect(drafts).toEqual([
      copy('privacy.draft.collect_trustee', { label: copy('privacy.collect.trustee_label') }),
      copy('privacy.draft.scrambled_ip'),
      `${copy('privacy.draft.safety_what')}${copy('privacy.draft.safety_why')}`,
      copy('privacy.draft.keep_hello'),
      copy('privacy.draft.keep_email_log'),
      copy('privacy.draft.keep_safety'),
      copy('privacy.draft.backups'),
      copy('privacy.draft.under_18_private'),
    ])
    const firstColumn = wrapper.findAll('tbody th').map((cell) => cell.text())
    expect(firstColumn).toEqual([
      copy('privacy.why.hello.what'),
      copy('privacy.why.trustee.what'),
      copy('privacy.draft.turnstile_what'),
      copy('privacy.draft.safety_what'),
    ])
  })

  it('replaces the P9 text a draft would change, rather than showing both', async () => {
    const text = (await mount()).text()
    expect(text).not.toContain(copy('privacy.keep.hello'))
    expect(text).not.toContain(copy('privacy.under_18.private'))
    expect(text).not.toContain('your contact details')
  })

  it('keeps the 999 signpost for young people', async () => {
    const wrapper = await mount()
    const section = wrapper.find('h2#if-you-are-under-18').element.parentElement!
    expect(section.textContent).toContain(copy('privacy.under_18.danger'))
    expect(section.textContent).toContain('999')
  })

  it('gives the table column and row headers', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('thead th[scope="col"]')).toHaveLength(3)
    expect(wrapper.findAll('tbody th[scope="row"]')).toHaveLength(4)
    expect(wrapper.find('table').attributes('aria-labelledby')).toBe('why-we-use-it')
    // Explicit roles, because the rows stack on a narrow screen.
    expect(wrapper.findAll('[role="columnheader"]')).toHaveLength(3)
    expect(wrapper.findAll('[role="rowheader"]')).toHaveLength(4)
    expect(wrapper.findAll('td[role="cell"]').every((cell) => cell.attributes('data-label'))).toBe(
      true,
    )
  })

  it('names no regions but the table, so landmarks stay few', async () => {
    const wrapper = await mount()
    expect(wrapper.findAll('section[aria-labelledby], section[aria-label]')).toHaveLength(0)
  })
})
