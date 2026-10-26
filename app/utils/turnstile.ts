/**
 * The parts of Cloudflare Turnstile's browser API that the spam check uses
 * (#20). Kept apart from the component so the token logic can be unit tested
 * without a browser.
 */
export interface TurnstileRenderOptions {
  sitekey: string
  action: string
  execution: 'execute'
  appearance: 'interaction-only'
  size: 'flexible' | 'compact'
  language: string
  theme: 'light'
  'response-field': false
  'refresh-expired': 'never'
  callback: (token: string) => void
  'error-callback': (code: string) => boolean
  'expired-callback': () => void
  'timeout-callback': () => void
  'before-interactive-callback': () => void
  'after-interactive-callback': () => void
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined
  execute: (widgetId: string) => void
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

/** Why a token couldn't be had. The component turns each into a message. */
export type TurnstileFailure = 'unavailable' | 'failed'

export class TurnstileError extends Error {
  constructor(readonly reason: TurnstileFailure) {
    super(`turnstile_${reason}`)
  }
}

export interface TurnstileWidget {
  /**
   * Runs the challenge and resolves with a fresh, single-use token. Calls
   * made while one is running share it.
   */
  getToken: () => Promise<string>
  /** Throws away the current token. Call after every send, failed or not. */
  reset: () => void
  remove: () => void
}

export interface TurnstileWidgetOptions {
  sitekey: string
  /** `hello` or `apply`; the server checks it matches the form. */
  action: string
  language: string
  /** Width available to the widget, in CSS pixels. */
  width: number
  /** Shown or hidden when Turnstile needs the visitor to tick a box. */
  onInteractive?: (needed: boolean) => void
}

/** Narrow containers get the compact widget so it never overflows (320px). */
export const COMPACT_BELOW = 300

export function createTurnstileWidget(
  api: TurnstileApi,
  container: HTMLElement,
  options: TurnstileWidgetOptions,
): TurnstileWidget {
  let pending: {
    resolve: (token: string) => void
    reject: (error: TurnstileError) => void
  } | null = null
  let running: Promise<string> | null = null

  const settle = (outcome: { token: string } | { error: TurnstileError }) => {
    const current = pending
    pending = null
    running = null
    options.onInteractive?.(false)
    if (!current) return
    if ('token' in outcome) current.resolve(outcome.token)
    else current.reject(outcome.error)
  }

  const fail = () => {
    settle({ error: new TurnstileError('failed') })
    // A failed or expired challenge can't be run again until it is reset.
    if (widgetId) api.reset(widgetId)
  }

  const widgetId = api.render(container, {
    sitekey: options.sitekey,
    action: options.action,
    // Runs only when the visitor presses Send, and is seen only if a box needs ticking.
    execution: 'execute',
    appearance: 'interaction-only',
    size: options.width < COMPACT_BELOW ? 'compact' : 'flexible',
    language: options.language,
    theme: 'light',
    // We send the token ourselves, so no hidden form field.
    'response-field': false,
    'refresh-expired': 'never',
    callback: (token) => settle({ token }),
    'error-callback': () => {
      fail()
      return true
    },
    'expired-callback': fail,
    'timeout-callback': fail,
    'before-interactive-callback': () => options.onInteractive?.(true),
    'after-interactive-callback': () => options.onInteractive?.(false),
  })

  return {
    getToken() {
      if (!widgetId) return Promise.reject(new TurnstileError('unavailable'))
      if (running) return running
      running = new Promise<string>((resolve, reject) => {
        pending = { resolve, reject }
      })
      api.execute(widgetId)
      return running
    },
    reset() {
      if (!widgetId) return
      settle({ error: new TurnstileError('failed') })
      api.reset(widgetId)
    },
    remove() {
      if (!widgetId) return
      settle({ error: new TurnstileError('unavailable') })
      api.remove(widgetId)
    },
  }
}

let loading: Promise<TurnstileApi> | null = null

/**
 * Adds Turnstile's script to the page once and resolves with its API. The
 * tag is added from code, not rendered by the server, so pages without the
 * spam check never mention Cloudflare's origin.
 */
export function loadTurnstileScript(src: string, timeoutMs: number): Promise<TurnstileApi> {
  const existing = (window as { turnstile?: TurnstileApi }).turnstile
  if (existing) return Promise.resolve(existing)
  if (loading) return loading

  loading = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script')
    const timer = window.setTimeout(() => fail(), timeoutMs)
    const fail = () => {
      window.clearTimeout(timer)
      script.remove()
      loading = null
      reject(new TurnstileError('unavailable'))
    }
    script.src = src
    script.async = true
    script.addEventListener('error', fail)
    script.addEventListener('load', () => {
      window.clearTimeout(timer)
      const api = (window as { turnstile?: TurnstileApi }).turnstile
      if (api) resolve(api)
      else fail()
    })
    document.head.append(script)
  })
  return loading
}
