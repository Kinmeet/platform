import { env } from 'cloudflare:test'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import adminAccess from '../../../../../server/middleware/10.admin-access'
import repliedHandler from '../../../../../server/api/admin/hello/[id]/replied.post'
import messagesHandler from '../../../../../server/api/admin/messages.get'
import { clearAccessKeyCache } from '../../../../../server/utils/admin/access'
import { isAdminPath } from '../../../../../server/utils/admin/guard'
import { AUD, TEAM, makeKey, signToken } from './access-token'

const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const HELLO_ID = '00000000-0000-4000-8000-000000000001'
let key: Awaited<ReturnType<typeof makeKey>>

beforeAll(async () => {
  key = await makeKey('key-1')
})

beforeEach(async () => {
  clearAccessKeyCache()
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify({ keys: [key.jwk] })),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, '00000000-0000-4000-8000-0000000000a1', 'Test Fox', 'test.fox@example.com', 'Made-up.', 1, 2)`,
    ).bind(HELLO_ID),
  ])
})

afterEach(() => vi.restoreAllMocks())

function app() {
  const instance = createApp()
  instance.use(adminAccess)
  instance.use('/api/admin/messages', messagesHandler)
  instance.use(
    `/api/admin/hello/${HELLO_ID}/replied`,
    defineEventHandler((event) => {
      event.context.params = { id: HELLO_ID }
      return repliedHandler(event)
    }),
  )
  instance.use(
    '/',
    defineEventHandler(() => 'public page'),
  )
  return toWebHandler(instance)
}

async function call(
  path: string,
  {
    method = 'GET',
    token,
    origin,
    config = true,
  }: { method?: string; token?: string; origin?: string; config?: boolean } = {},
) {
  const headers: Record<string, string> = {}
  if (token) headers['Cf-Access-Jwt-Assertion'] = token
  if (origin) headers.Origin = origin
  return app()(new Request(`${ORIGIN}${path}`, { method, headers }), {
    cloudflare: {
      env: {
        DB: env.DB,
        SITE_ORIGIN: ORIGIN,
        KINMEET_ENV: 'staging',
        ...(config ? { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD } : {}),
      },
    },
  })
}

const fresh = () => {
  const now = Math.floor(Date.now() / 1000)
  return signToken(key, { iat: now, nbf: now, exp: now + 600 })
}

describe('isAdminPath', () => {
  it('covers the admin page and API only', () => {
    for (const path of ['/admin', '/admin/', '/admin?x=1', '/api/admin/messages', '/api/admin']) {
      expect(isAdminPath(path)).toBe(true)
    }
    for (const path of ['/', '/administrator', '/api/hello', '/api/administer', '/x/admin']) {
      expect(isAdminPath(path)).toBe(false)
    }
  })
})

describe('admin access', () => {
  it('refuses the admin API without a token, and marks it noindex', async () => {
    const response = await call('/api/admin/messages')
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' })
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('refuses the admin page without a token', async () => {
    expect((await call('/admin')).status).toBe(403)
  })

  it('lets a valid Access token read the list', async () => {
    const response = await call('/api/admin/messages', { token: await fresh() })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { messages: { callName: string }[] }
    expect(body.messages.map((m) => m.callName)).toEqual(['Test Fox'])
  })

  it('fails closed when Access is not configured', async () => {
    expect(
      (await call('/api/admin/messages', { token: await fresh(), config: false })).status,
    ).toBe(403)
  })

  it('fails closed when the Access keys cannot be fetched', async () => {
    vi.mocked(globalThis.fetch).mockImplementation(
      async () => new Response('down', { status: 500 }),
    )
    expect((await call('/api/admin/messages', { token: await fresh() })).status).toBe(403)
  })

  it('needs our own origin for an action, as well as the token', async () => {
    const token = await fresh()
    const path = `/api/admin/hello/${HELLO_ID}/replied`
    expect((await call(path, { method: 'POST', token })).status).toBe(403)
    expect(
      (await call(path, { method: 'POST', token, origin: 'https://example.com' })).status,
    ).toBe(403)
    const response = await call(path, { method: 'POST', token, origin: ORIGIN })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
  })

  it('leaves other paths alone', async () => {
    const response = await call('/')
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('public page')
  })
})
