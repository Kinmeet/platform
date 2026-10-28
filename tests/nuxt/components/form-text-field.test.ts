import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import FormTextField from '../../../app/components/FormTextField.vue'

// The long-text count (Robin, #158 and #159): it says the limit up front, and
// its status speaks once typing pauses, not on every key. Made-up text only.

let wrappers: { unmount: () => void }[] = []

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.useRealTimers()
})

async function mountField(value: string) {
  const wrapper = await mountSuspended(FormTextField, {
    props: {
      id: 'sample',
      label: 'A made-up question',
      multiline: true,
      maxLength: 1000,
      modelValue: value,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('the long-text count', () => {
  it('waits for a pause before updating the status, then speaks once', async () => {
    const wrapper = await mountField('')
    const status = () => wrapper.find('[role="status"]').text()
    expect(status()).toBe('')

    await wrapper.setProps({ modelValue: 'x'.repeat(950) })
    await wrapper.setProps({ modelValue: 'x'.repeat(951) })
    expect(status()).toBe('')
    vi.advanceTimersByTime(749)
    await nextTick()
    expect(status()).toBe('')
    vi.advanceTimersByTime(1)
    await nextTick()
    expect(status()).toBe('You have 49 characters left')

    await wrapper.setProps({ modelValue: 'x'.repeat(1003) })
    vi.advanceTimersByTime(750)
    await nextTick()
    expect(status()).toBe('You have 3 characters too many')
  })

  it('clears straight away when the answer is no longer near the limit', async () => {
    const wrapper = await mountField('x'.repeat(950))
    await wrapper.setProps({ modelValue: 'x'.repeat(951) })
    vi.advanceTimersByTime(750)
    await nextTick()
    expect(wrapper.find('[role="status"]').text()).not.toBe('')
    await wrapper.setProps({ modelValue: 'x'.repeat(10) })
    expect(wrapper.find('[role="status"]').text()).toBe('')
  })
})
