import { describe, expect, it } from 'vitest'
import {
  COMPACT_BELOW,
  createTurnstileWidget,
  TurnstileError,
  type TurnstileApi,
  type TurnstileRenderOptions,
} from '../../../../app/utils/turnstile'

// A stand-in for Cloudflare's API that records calls and lets each test fire
// the callbacks Turnstile would.
function fakeApi({ renders = true } = {}) {
  const widgetId = renders ? 'widget-1' : undefined
  const calls: string[] = []
  let options: TurnstileRenderOptions | undefined
  const api: TurnstileApi = {
    render: (_container, given) => {
      options = given
      calls.push('render')
      return widgetId
    },
    execute: (id) => calls.push(`execute:${id}`),
    reset: (id) => calls.push(`reset:${id}`),
    remove: (id) => calls.push(`remove:${id}`),
  }
  return {
    api,
    calls,
    get options() {
      if (!options) throw new Error('not rendered')
      return options
    },
  }
}

const element = {} as unknown as HTMLElement
const base = { sitekey: '1x00000000000000000000AA', action: 'hello', language: 'en-GB', width: 400 }

describe('Turnstile widget', () => {
  it('runs only when asked, is seen only when needed, and keeps no form field', () => {
    const fake = fakeApi()
    createTurnstileWidget(fake.api, element, base)
    expect(fake.options).toMatchObject({
      sitekey: base.sitekey,
      action: 'hello',
      execution: 'execute',
      appearance: 'interaction-only',
      'response-field': false,
      size: 'flexible',
      language: 'en-GB',
    })
    expect(fake.calls).toEqual(['render'])
  })

  it('uses the compact widget in narrow containers', () => {
    const fake = fakeApi()
    createTurnstileWidget(fake.api, element, { ...base, width: COMPACT_BELOW - 1 })
    expect(fake.options.size).toBe('compact')
  })

  it('resolves getToken with the token from the challenge', async () => {
    const fake = fakeApi()
    const widget = createTurnstileWidget(fake.api, element, base)
    const token = widget.getToken()
    expect(fake.calls).toContain('execute:widget-1')
    fake.options.callback('token-one')
    await expect(token).resolves.toBe('token-one')
  })

  it('shares one challenge between calls made while it runs', async () => {
    const fake = fakeApi()
    const widget = createTurnstileWidget(fake.api, element, base)
    const first = widget.getToken()
    const second = widget.getToken()
    expect(fake.calls.filter((call) => call.startsWith('execute'))).toHaveLength(1)
    fake.options.callback('token-one')
    await expect(first).resolves.toBe('token-one')
    await expect(second).resolves.toBe('token-one')
  })

  it('gets a fresh token after a reset, because tokens are single-use', async () => {
    const fake = fakeApi()
    const widget = createTurnstileWidget(fake.api, element, base)
    const first = widget.getToken()
    fake.options.callback('token-one')
    await first

    widget.reset()
    expect(fake.calls).toContain('reset:widget-1')
    const second = widget.getToken()
    fake.options.callback('token-two')
    await expect(second).resolves.toBe('token-two')
    expect(fake.calls.filter((call) => call.startsWith('execute'))).toHaveLength(2)
  })

  it.each(['error-callback', 'expired-callback', 'timeout-callback'] as const)(
    'rejects with "failed" and resets on %s',
    async (name) => {
      const fake = fakeApi()
      const widget = createTurnstileWidget(fake.api, element, base)
      const token = widget.getToken()
      if (name === 'error-callback') expect(fake.options[name]('300030')).toBe(true)
      else fake.options[name]()
      await expect(token).rejects.toEqual(new TurnstileError('failed'))
      expect(fake.calls).toContain('reset:widget-1')
    },
  )

  it('rejects a waiting getToken when the widget is reset', async () => {
    const fake = fakeApi()
    const widget = createTurnstileWidget(fake.api, element, base)
    const token = widget.getToken()
    widget.reset()
    await expect(token).rejects.toMatchObject({ reason: 'failed' })
  })

  it('says when a box needs ticking, and when it is done', () => {
    const fake = fakeApi()
    const seen: boolean[] = []
    createTurnstileWidget(fake.api, element, {
      ...base,
      onInteractive: (needed) => seen.push(needed),
    })
    fake.options['before-interactive-callback']()
    fake.options['after-interactive-callback']()
    expect(seen).toEqual([true, false])
  })

  it('is unavailable if Turnstile could not render', async () => {
    const fake = fakeApi({ renders: false })
    const widget = createTurnstileWidget(fake.api, element, base)
    await expect(widget.getToken()).rejects.toMatchObject({ reason: 'unavailable' })
  })

  it('removes the widget and rejects anything waiting', async () => {
    const fake = fakeApi()
    const widget = createTurnstileWidget(fake.api, element, base)
    const token = widget.getToken()
    widget.remove()
    await expect(token).rejects.toMatchObject({ reason: 'unavailable' })
    expect(fake.calls).toContain('remove:widget-1')
  })
})
