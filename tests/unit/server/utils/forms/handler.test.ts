import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HELLO_BODY_CAP, helloSchema } from '../../../../../shared/forms/hello'
import { handleFormSubmission } from '../../../../../server/utils/forms/handler'

// Made-up test data and Cloudflare's documented dummy Turnstile values only.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const allow = { limit: async () => ({ success: true }) }
const fullEnv = {
  SITE_ORIGIN: ORIGIN,
  KINMEET_ENV: 'staging',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  RATE_LIMIT_HMAC_KEY: 'made-up-test-key',
  FORM_RATE_LIMITER: allow,
  FORM_GLOBAL_RATE_LIMITER: allow,
}
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

let stored: unknown[]
let siteverify: ReturnType<typeof vi.fn>
let errors: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stored = []
  siteverify = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ success: true, hostname: new URL(ORIGIN).host, action: 'hello' }),
      ),
  )
  vi.stubGlobal('fetch', siteverify)
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function submit(env: Record<string, unknown>) {
  const app = createApp()
  app.use(
    defineEventHandler((event) =>
      handleFormSubmission(event, {
        form: 'hello',
        schema: helloSchema,
        receipt: 'not_requested',
        bodyCap: HELLO_BODY_CAP,
        exists: async () => false,
        store: async (_event, submission) => {
          stored.push(submission)
          return 'stored'
        },
      }),
    ),
  )
  const handler = toWebHandler(app)
  return handler(
    new Request(`${ORIGIN}/api/hello`, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }),
    { cloudflare: { env } },
  )
}

describe('handleFormSubmission configuration', () => {
  it('stores a valid submission when everything is configured', async () => {
    const response = await submit(fullEnv)
    expect(errors.mock.calls).toEqual([])
    expect(response.status).toBe(201)
    expect(stored).toHaveLength(1)
  })

  // Staging's first deploy comes before its secrets are set (Rowan, #44), so
  // each missing setting must fail closed: 503, nothing stored, nothing sent.
  for (const missing of [
    'TURNSTILE_SECRET_KEY',
    'RATE_LIMIT_HMAC_KEY',
    'SITE_ORIGIN',
    'FORM_RATE_LIMITER',
    'FORM_GLOBAL_RATE_LIMITER',
  ] as const) {
    it(`answers 503 and stores nothing when ${missing} is missing`, async () => {
      for (const value of [undefined, '']) {
        stored = []
        const response = await submit({ ...fullEnv, [missing]: value })
        expect(response.status, `${missing}=${String(value)}`).toBe(503)
        expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
        expect(response.headers.get('Cache-Control')).toBe('no-store')
        expect(stored).toEqual([])
        expect(siteverify).not.toHaveBeenCalled()
      }
    })
  }

  it('logs a code only when configuration is missing', async () => {
    await submit({ ...fullEnv, TURNSTILE_SECRET_KEY: undefined })
    expect(errors.mock.calls).toEqual([[JSON.stringify({ code: 'hello_env_missing' })]])
  })
})
