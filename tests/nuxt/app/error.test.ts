import { createError, useNuxtApp } from '#app'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it } from 'vitest'
import ErrorPage from '../../../app/error.vue'

// The error page's two kinds (#18, Kit's review of #132). The 404 is covered
// end to end; this mounts the page for any other error and checks that
// nothing from the error itself reaches the page. Made-up error text only.
const MESSAGE = 'Made-up failure message for testing'
const STACK = 'Error: made-up stack line\n    at testOnly (made-up.ts:1:1)'

let wrappers: { unmount: () => void }[] = []

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
})

// The copy as the app renders it (the locale files are compiled in this
// environment, so they can't be read as plain strings).
function copy(key: string): string {
  return useNuxtApp().$i18n.t(key)
}

async function mountWith(statusCode: number) {
  const wrapper = await mountSuspended(ErrorPage, {
    props: {
      error: Object.assign(
        createError({ statusCode, statusMessage: 'Made-up status', message: MESSAGE }),
        { stack: STACK },
      ),
    },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('error page', () => {
  it('shows the failed copy for an error that is not a 404', async () => {
    const wrapper = await mountWith(500)
    expect(wrapper.find('h1').text()).toBe(copy('error_page.failed.title'))
    expect(wrapper.text()).toContain(copy('error_page.failed.body'))
    expect(wrapper.text()).not.toContain(copy('error_page.not_found.title'))
    expect(wrapper.find('.error-page a[href="/"]').text()).toBe(copy('error_page.home'))
  })

  it('never shows the error message or stack', async () => {
    const wrapper = await mountWith(500)
    const html = wrapper.html()
    for (const text of [MESSAGE, 'made-up stack line', 'made-up.ts', 'Made-up status']) {
      expect(html, text).not.toContain(text)
    }
  })

  it('shows the missing page copy for a 404', async () => {
    const wrapper = await mountWith(404)
    expect(wrapper.find('h1').text()).toBe(copy('error_page.not_found.title'))
    expect(wrapper.html()).not.toContain(MESSAGE)
  })
})
