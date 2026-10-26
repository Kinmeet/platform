import { env } from 'cloudflare:test'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import adminAccess from '../../../../server/middleware/10.admin-access'
import helloHandOver from '../../../../server/api/admin/hello/[id]/safeguarding.post'
import applyHandOver from '../../../../server/api/admin/applications/[id]/safeguarding.post'
import { clearAccessKeyCache } from '../../../../server/utils/admin/access'
import { AUD, TEAM, makeKey, signToken } from '../utils/admin/access-token'

// The two "Pass to safeguarding" routes behind admin Access (#36).
// Made-up test data only.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
let key: Awaited<ReturnType<typeof makeKey>>
let helloId: string
let applicationId: string
let errorLog: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  key = await makeKey('key-1')
})

beforeEach(async () => {
  clearAccessKeyCache()
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify({ keys: [key.jwk] })),
  )
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
  // The store refuses deletes, so each test uses fresh ids.
  helloId = crypto.randomUUID()
  applicationId = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, ?, 'Test Fox', 'test.fox@example.com', 'Made-up disclosure.', 1, 2)`,
    ).bind(helloId, crypto.randomUUID()),
    env.DB.prepare(
      `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email,
                                 answers, received_at, delete_after)
       VALUES (?, ?, 'trustee', 'no', 'Sample Applicant', 'sample@example.org',
               '{"why_trustee":"Made-up answer."}', 1, 2)`,
    ).bind(applicationId, crypto.randomUUID()),
  ])
})

afterEach(() => vi.restoreAllMocks())

function app() {
  const instance = createApp()
  instance.use(adminAccess)
  instance.use(
    '/api/admin/hello',
    defineEventHandler((event) => {
      event.context.params = { id: helloId }
      return helloHandOver(event)
    }),
  )
  instance.use(
    '/api/admin/applications',
    defineEventHandler((event) => {
      event.context.params = { id: applicationId }
      return applyHandOver(event)
    }),
  )
  return toWebHandler(instance)
}

async function pass(
  path: string,
  { token, store = true }: { token?: string; store?: boolean } = {},
) {
  const headers: Record<string, string> = { Origin: ORIGIN }
  if (token) headers['Cf-Access-Jwt-Assertion'] = token
  return app()(new Request(`${ORIGIN}${path}`, { method: 'POST', headers }), {
    cloudflare: {
      env: {
        DB: env.DB,
        ...(store ? { SAFEGUARDING_DB: env.SAFEGUARDING_DB } : {}),
        SITE_ORIGIN: ORIGIN,
        KINMEET_ENV: 'staging',
        ACCESS_TEAM_DOMAIN: TEAM,
        ACCESS_AUD: AUD,
      },
    },
  })
}

const fresh = () => {
  const now = Math.floor(Date.now() / 1000)
  return signToken(key, { iat: now, nbf: now, exp: now + 600 })
}

const helloPath = () => `/api/admin/hello/${helloId}/safeguarding`
const applyPath = () => `/api/admin/applications/${applicationId}/safeguarding`

async function stillListed() {
  const hello = await env.DB.prepare('SELECT 1 FROM hello_messages WHERE id = ?')
    .bind(helloId)
    .first()
  const apply = await env.DB.prepare('SELECT 1 FROM applications WHERE id = ?')
    .bind(applicationId)
    .first()
  return { hello: hello !== null, apply: apply !== null }
}

async function copied(id: string) {
  return (
    (await env.SAFEGUARDING_DB.prepare('SELECT 1 FROM handed_over_items WHERE id = ?')
      .bind(id)
      .first()) !== null
  )
}

describe('pass to safeguarding routes', () => {
  it('refuses anyone without a valid Access token, and moves nothing', async () => {
    for (const path of [helloPath(), applyPath()]) {
      expect((await pass(path)).status).toBe(403)
      expect((await pass(path, { token: 'not-a-token' })).status).toBe(403)
    }
    expect(await stillListed()).toEqual({ hello: true, apply: true })
    expect(await copied(helloId)).toBe(false)
    expect(await copied(applicationId)).toBe(false)
  })

  it('moves a message and replies with nothing from it', async () => {
    const response = await pass(helloPath(), { token: await fresh() })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe(JSON.stringify({ ok: true }))
    expect(await stillListed()).toEqual({ hello: false, apply: true })
    expect(await copied(helloId)).toBe(true)
  })

  it('moves an application', async () => {
    expect((await pass(applyPath(), { token: await fresh() })).status).toBe(200)
    expect(await stillListed()).toEqual({ hello: true, apply: false })
    expect(await copied(applicationId)).toBe(true)
  })

  it('answers not found the second time', async () => {
    const token = await fresh()
    await pass(helloPath(), { token })
    const again = await pass(helloPath(), { token })
    expect(again.status).toBe(404)
    expect(await again.json()).toEqual({ ok: false, error: 'not_found' })
  })

  it('fails closed without the safeguarding store, leaving the row listed', async () => {
    const response = await pass(helloPath(), { token: await fresh(), store: false })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(await stillListed()).toEqual({ hello: true, apply: true })
    expect(errorLog.mock.calls).toEqual([[JSON.stringify({ code: 'safeguarding_db_missing' })]])
  })
})
