import { env } from 'cloudflare:test'
import { createApp, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import helloHandler from '../../../../server/api/hello.post'
import type { RateLimiter } from '../../../../server/utils/forms/rate-limit'

// Made-up test data and Cloudflare's documented dummy Turnstile values.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const HOST = 'kinmeet-staging.kinmeet.workers.dev'
const valid = {
  submissionId: '3f1c2b9a-6d4e-4a7b-9c2d-1e5f6a7b8c9d',
  callName: 'Test Fox',
  email: 'test.fox@example.com',
  message: 'Hello from a made-up test.',
  turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
}

const allow: RateLimiter = { limit: async () => ({ success: true }) }
const deny: RateLimiter = { limit: async () => ({ success: false }) }

function call(body: unknown, options: { limiter?: RateLimiter; db?: unknown } = {}) {
  const app = createApp()
  app.use('/api/hello', helloHandler)
  const handler = toWebHandler(app)
  return handler(
    new Request(`${ORIGIN}/api/hello`, {
      method: 'POST',
      headers: {
        Origin: ORIGIN,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': '192.0.2.10',
      },
      body: JSON.stringify(body),
    }),
    {
      cloudflare: {
        env: {
          DB: 'db' in options ? options.db : env.DB,
          SITE_ORIGIN: ORIGIN,
          KINMEET_ENV: 'staging',
          TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
          RATE_LIMIT_HMAC_KEY: 'test-only-hmac-key',
          FORM_RATE_LIMITER: options.limiter ?? allow,
          FORM_GLOBAL_RATE_LIMITER: allow,
        },
      },
    },
  )
}

let siteverify: { success: boolean; hostname?: string; action?: string }
const logs: string[] = []

beforeEach(async () => {
  await env.DB.prepare('DELETE FROM hello_messages').run()
  siteverify = { success: true, hostname: HOST, action: 'hello' }
  logs.length = 0
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify(siteverify)),
  )
  vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
    logs.push(String(line))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function rowCount() {
  return (await env.DB.prepare('SELECT count(*) AS n FROM hello_messages').first<{ n: number }>())!
    .n
}

describe('POST /api/hello', () => {
  it('stores a message and answers 201 with no receipt', async () => {
    const response = await call(valid)
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ok: true, receipt: 'not_requested' })
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await rowCount()).toBe(1)
  })

  it('answers a retry with 200 and stores nothing new', async () => {
    await call(valid)
    const response = await call({ ...valid, message: 'Different made-up text.' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, receipt: 'not_requested' })
    expect(await rowCount()).toBe(1)
  })

  it('answers 422 for invalid fields and stores nothing', async () => {
    const response = await call({ ...valid, email: 'not-an-email' })
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      ok: false,
      errors: [{ field: 'email', code: 'invalid_email' }],
    })
    expect(await rowCount()).toBe(0)
  })

  it('answers 403 when Turnstile fails and stores nothing', async () => {
    siteverify = { success: false }
    expect((await call(valid)).status).toBe(403)
    expect(await rowCount()).toBe(0)
  })

  it('answers 429 with Retry-After when rate limited', async () => {
    const response = await call(valid, { limiter: deny })
    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('60')
  })

  it('fails closed with 503 when the database is missing, logging a code only', async () => {
    const response = await call(valid, { db: undefined })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(logs).toEqual([JSON.stringify({ code: 'hello_unavailable' })])
    for (const value of Object.values(valid)) expect(logs.join()).not.toContain(value)
  })
})
