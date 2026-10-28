import { env } from 'cloudflare:test'
import { createApp, defineEventHandler, toWebHandler } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import adminAccess from '../../../../server/middleware/10.admin-access'
import helloHandOver from '../../../../server/api/admin/hello/[id]/safeguarding.post'
import applyHandOver from '../../../../server/api/admin/applications/[id]/safeguarding.post'
import submissionHandOver from '../../../../server/api/admin/submissions/[id]/safeguarding.post'
import { clearAccessKeyCache } from '../../../../server/utils/admin/access'
import { AUD, TEAM, makeKey, signToken } from '../utils/admin/access-token'
import { makeTestKey } from './test-key'

// The two "Pass to safeguarding" routes behind admin Access (#36).
// Made-up test data only.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
let key: Awaited<ReturnType<typeof makeKey>>
let helloId: string
let applicationId: string
let submissionId: string
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
  instance.use(
    '/api/admin/submissions',
    defineEventHandler((event) => {
      event.context.params = { id: submissionId }
      return submissionHandOver(event)
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
        ...(store ? { SAFEGUARDING_KEY: makeTestKey() } : {}),
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
    (await env.DB.prepare('SELECT 1 FROM safeguarding_items WHERE id = ?').bind(id).first()) !==
    null
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

  it('fails closed without the safeguarding key, leaving the row listed', async () => {
    const response = await pass(helloPath(), { token: await fresh(), store: false })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, error: 'unavailable' })
    expect(await stillListed()).toEqual({ hello: true, apply: true })
    expect(errorLog.mock.calls).toEqual([
      [JSON.stringify({ code: 'safeguarding_store_unavailable' })],
    ])
  })
})

describe('the generic pass to safeguarding route (#160)', () => {
  const path = () => `/api/admin/submissions/${submissionId}/safeguarding`

  /** A form of its own on the say hello version, so its slug isn't `hello`. */
  async function otherForm(): Promise<string> {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, 'form', 'draft', 1)`,
      ).bind(id, `sample-${id.slice(0, 8)}`),
      env.DB.prepare(
        `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
         SELECT ?, 1, v.purpose, v.definition, v.text, 1, 'migration'
         FROM form_versions AS v JOIN forms AS f ON f.id = v.form_id AND v.version = f.current_version
         WHERE f.slug = 'hello'`,
      ).bind(id),
      env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
    ])
    return id
  }

  async function submitTo(formId: string, answers: Record<string, string>) {
    submissionId = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, submission_id, form_id, version, call_name, email, answers,
                                     received_at, delete_after)
       SELECT ?, ?, f.id, f.current_version, 'Test Fox', 'test.fox@example.com', ?, 1, 2
       FROM forms AS f WHERE f.id = ?`,
    )
      .bind(submissionId, crypto.randomUUID(), JSON.stringify(answers), formId)
      .run()
  }

  async function formIdOf(slug: string) {
    return (await env.DB.prepare('SELECT id FROM forms WHERE slug = ?').bind(slug).first<{
      id: string
    }>())!.id
  }

  async function listed() {
    return (
      (await env.DB.prepare('SELECT 1 FROM form_submissions WHERE id = ?')
        .bind(submissionId)
        .first()) !== null
    )
  }

  it('refuses anyone without a valid Access token, and moves nothing', async () => {
    await submitTo(await formIdOf('hello'), { message: 'Made-up disclosure.' })
    expect((await pass(path())).status).toBe(403)
    expect(await listed()).toBe(true)
    expect(await copied(submissionId)).toBe(false)
  })

  it.each(['hello', 'trustee'])('moves a submission from the %s form', async (slug) => {
    await submitTo(
      await formIdOf(slug),
      slug === 'hello' ? { message: 'Made-up disclosure.' } : { why_trustee: 'Made-up answer.' },
    )
    const response = await pass(path(), { token: await fresh() })
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe(JSON.stringify({ ok: true }))
    expect(await listed()).toBe(false)
    expect(await copied(submissionId)).toBe(true)
  })

  it('answers not found for a form the store does not take yet, and moves nothing', async () => {
    await submitTo(await otherForm(), { message: 'Made-up disclosure.' })
    const response = await pass(path(), { token: await fresh() })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ ok: false, error: 'not_found' })
    expect(await listed()).toBe(true)
    expect(await copied(submissionId)).toBe(false)
  })

  it('answers not found the second time, and for an id that does not exist', async () => {
    await submitTo(await formIdOf('hello'), { message: 'Made-up disclosure.' })
    const token = await fresh()
    expect((await pass(path(), { token })).status).toBe(200)
    expect((await pass(path(), { token })).status).toBe(404)
    submissionId = crypto.randomUUID()
    expect((await pass(path(), { token })).status).toBe(404)
  })
})
