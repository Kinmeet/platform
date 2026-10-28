import { useNuxtApp } from '#app'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import FormSafetyNote from '../../../app/components/FormSafetyNote.vue'

// The safety note every stored form with free text shows (SG6, Ezra #162).

let wrappers: { unmount: () => void }[] = []
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

async function mountNote(props: { form: { safetyNote: boolean }; wording?: string }) {
  const wrapper = await mountSuspended(FormSafetyNote, { props })
  wrappers.push(wrapper)
  return wrapper
}

describe('the safety note', () => {
  it('shows the shared wording when the form takes free text', async () => {
    const wording = useNuxtApp().$i18n.t('forms.safety_note')
    expect(wording).not.toBe('forms.safety_note')
    expect((await mountNote({ form: { safetyNote: true } })).text()).toBe(wording)
  })

  it('shows a form’s own fixed wording when given one', async () => {
    const wording = useNuxtApp().$i18n.t('hello.kept.safety')
    const wrapper = await mountNote({ form: { safetyNote: true }, wording: 'hello.kept.safety' })
    expect(wrapper.text()).toBe(wording)
  })

  it('shows nothing for a form without free text', async () => {
    expect((await mountNote({ form: { safetyNote: false } })).find('p').exists()).toBe(false)
  })
})
