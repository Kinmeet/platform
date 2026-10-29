import { env } from 'cloudflare:test'
import { createApp, createRouter, toWebHandler, type EventHandler } from 'h3'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import adminAccess from '../../../../server/middleware/10.admin-access'
import listHandler from '../../../../server/api/admin/forms.get'
import createHandler from '../../../../server/api/admin/forms.post'
import detailHandler from '../../../../server/api/admin/forms/[id].get'
import draftHandler from '../../../../server/api/admin/forms/[id]/draft.put'
import checkHandler from '../../../../server/api/admin/forms/[id]/check.get'
import publishHandler from '../../../../server/api/admin/forms/[id]/publish.post'
import statusHandler from '../../../../server/api/admin/forms/[id]/status.post'
import submissionsHandler from '../../../../server/api/admin/forms/[id]/submissions.get'
import repliedHandler from '../../../../server/api/admin/submissions/[id]/replied.post'
import outcomeHandler from '../../../../server/api/admin/submissions/[id]/outcome-told.post'
import { clearAccessKeyCache } from '../../../../server/utils/admin/access'
import type {
  AdminFormCheck,
  AdminFormDetail,
  AdminFormSummary,
  AdminSubmission,
} from '../../../../shared/admin'
import type { PublicForm } from '../../../../shared/forms/view'
import { FORM_DRAFT_BODY_LIMIT } from '../../../../shared/routes'
import { AUD, TEAM, makeKey, signToken } from '../utils/admin/access-token'

/** The publish Access application's audience (made up), separate from the main one. */
const PUBLISH_AUD = 'test-publish-audience-tag'

// The form builder's API and the generic submissions list (ADR-0010 phase B,
// #160), behind the real admin middleware. Made-up test data only.
const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'
const ACTOR = '00000000-0000-4000-8000-00000000f00d'
let key: Awaited<ReturnType<typeof makeKey>>

/** Every field any of these routes can reply with. */
interface Reply extends Partial<AdminFormDetail> {
  ok?: boolean
  error?: string
  forms?: AdminFormSummary[]
  check?: AdminFormCheck
  preview?: PublicForm | null
  submissions?: AdminSubmission[]
  version?: number
}

type Text = Record<string, Record<string, string>>

beforeAll(async () => {
  key = await makeKey('key-1')
})

beforeEach(() => {
  clearAccessKeyCache()
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async () => new Response(JSON.stringify({ keys: [key.jwk] })),
  )
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => vi.restoreAllMocks())

function app() {
  const router = createRouter()
  const routes: [string, string, EventHandler][] = [
    ['get', '/api/admin/forms', listHandler],
    ['post', '/api/admin/forms', createHandler],
    ['get', '/api/admin/forms/:id', detailHandler],
    ['put', '/api/admin/forms/:id/draft', draftHandler],
    ['get', '/api/admin/forms/:id/check', checkHandler],
    ['post', '/api/admin/forms/:id/publish', publishHandler],
    ['post', '/api/admin/forms/:id/status', statusHandler],
    ['get', '/api/admin/forms/:id/submissions', submissionsHandler],
    ['post', '/api/admin/submissions/:id/replied', repliedHandler],
    ['post', '/api/admin/submissions/:id/outcome-told', outcomeHandler],
  ]
  for (const [method, path, handler] of routes)
    (router[method as 'get'] as (path: string, handler: EventHandler) => void)(path, handler)
  const instance = createApp()
  instance.use(adminAccess)
  instance.use(router)
  return toWebHandler(instance)
}

async function token(claims: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return signToken(key, { iat: now, nbf: now, exp: now + 600, ...claims })
}

/** A fresh token from the publish application, as Access issues after MFA. */
const publishToken = (claims: Record<string, unknown> = {}) =>
  token({ aud: [PUBLISH_AUD], exp: Math.floor(Date.now() / 1000) + 300, ...claims })

async function call(
  method: string,
  path: string,
  {
    body,
    signed = true,
    origin = ORIGIN,
    contentType = 'application/json',
    jwt,
    publishAud = PUBLISH_AUD,
  }: {
    body?: unknown
    signed?: boolean
    origin?: string | null
    contentType?: string
    /** The Access token to send; a fresh main admin token by default. */
    jwt?: string
    publishAud?: string
  } = {},
) {
  const headers: Record<string, string> = {}
  if (origin) headers.Origin = origin
  if (signed) headers['Cf-Access-Jwt-Assertion'] = jwt ?? (await token())
  if (body !== undefined) headers['Content-Type'] = contentType
  const response = await app()(
    new Request(`${ORIGIN}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    }),
    {
      cloudflare: {
        env: {
          DB: env.DB,
          SITE_ORIGIN: ORIGIN,
          KINMEET_ENV: 'staging',
          ACCESS_TEAM_DOMAIN: TEAM,
          ACCESS_AUD: AUD,
          ...(publishAud ? { ACCESS_PUBLISH_AUD: publishAud } : {}),
        },
      },
    },
  )
  const text = await response.text()
  return { status: response.status, body: text ? (JSON.parse(text) as Reply) : null }
}

/**
 * An open application form of its own, on the trustee form's steps with
 * made-up wording, so a wording change can publish (the trustee copy names
 * DBS checks, which always needs a second approval).
 */
async function freshApplication(): Promise<string> {
  const id = crypto.randomUUID()
  const source = await env.DB.prepare(
    `SELECT v.purpose, v.definition, v.text FROM form_versions AS v
     JOIN forms AS f ON f.id = v.form_id AND v.version = f.current_version
     WHERE f.slug = 'trustee'`,
  ).first<{ purpose: string; definition: string; text: string }>()
  const words = JSON.parse(source!.text)['en-GB'] as Record<string, string>
  for (const k of Object.keys(words)) words[k] = `Sample wording for ${k}`
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, 'application', 'draft', 1)`,
    ).bind(id, `sample-${id.slice(0, 8)}`),
    env.DB.prepare(
      `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
       VALUES (?, 1, ?, ?, ?, 1, 'migration')`,
    ).bind(id, source!.purpose, source!.definition, JSON.stringify({ 'en-GB': words })),
    env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
  ])
  return id
}

const now = () => Math.floor(Date.now() / 1000)

async function auditCount() {
  return (await env.DB.prepare('SELECT count(*) AS n FROM audit_log').first<{ n: number }>())!.n
}

describe('without a valid Access token', () => {
  it('every route refuses, and nothing is written', async () => {
    const id = await freshApplication()
    const before = await auditCount()
    for (const [method, path, body] of [
      ['GET', '/api/admin/forms'],
      ['POST', '/api/admin/forms', { slug: 'sample-new', kind: 'form' }],
      ['GET', `/api/admin/forms/${id}`],
      ['PUT', `/api/admin/forms/${id}/draft`, { purpose: 'say_hello', definition: {}, text: {} }],
      ['GET', `/api/admin/forms/${id}/check`],
      ['POST', `/api/admin/forms/${id}/publish`],
      ['POST', `/api/admin/forms/${id}/status`, { status: 'closed' }],
      ['GET', `/api/admin/forms/${id}/submissions`],
      ['POST', `/api/admin/submissions/${id}/replied`],
      ['POST', `/api/admin/submissions/${id}/outcome-told`],
    ] as [string, string, unknown?][]) {
      const response = await call(method, path, { body, signed: false })
      expect(response.status, `${method} ${path}`).toBe(403)
      expect(response.body).toEqual({ ok: false, error: 'forbidden' })
    }
    expect(await auditCount()).toBe(before)
    expect(await env.DB.prepare(`SELECT 1 FROM forms WHERE slug = 'sample-new'`).first()).toBeNull()
    expect(
      await env.DB.prepare('SELECT 1 FROM form_drafts WHERE form_id = ?').bind(id).first(),
    ).toBeNull()
  })

  it('a change from another origin is refused, even with a token', async () => {
    const id = await freshApplication()
    for (const origin of ['https://example.com', null]) {
      const response = await call('POST', `/api/admin/forms/${id}/status`, {
        body: { status: 'closed' },
        origin,
      })
      expect(response.status).toBe(403)
    }
    expect((await call('GET', `/api/admin/forms/${id}`)).body!.form!.status).toBe('open')
  })
})

describe('building a form', () => {
  it('lists, creates, saves, checks, previews, publishes and closes', async () => {
    const created = await call('POST', '/api/admin/forms', {
      body: { slug: 'sample-created', kind: 'form' },
    })
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ ok: true })
    expect(
      (await call('POST', '/api/admin/forms', { body: { slug: 'sample-created', kind: 'form' } }))
        .status,
    ).toBe(409)
    const list = await call('GET', '/api/admin/forms')
    expect(list.body!.forms!.map((form: { slug: string }) => form.slug)).toContain('sample-created')

    const id = await freshApplication()
    const detail = (await call('GET', `/api/admin/forms/${id}`)).body!
    const draft = {
      purpose: detail.current!.purpose,
      definition: detail.current!.definition,
      text: structuredClone(detail.current!.text) as Text,
    }
    draft.text['en-GB']!.title = 'A made-up new title'
    const saved = await call('PUT', `/api/admin/forms/${id}/draft`, { body: draft })
    expect(saved).toEqual({
      status: 200,
      body: { ok: true, check: { ok: true, problems: [], needsSecondApproval: false } },
    })

    const checked = (await call('GET', `/api/admin/forms/${id}/check`)).body!
    expect(checked.check!.ok).toBe(true)
    // The preview is what the form's page would get, and no more.
    expect(checked.preview).toMatchObject({
      kind: 'application',
      version: 2,
      safetyNote: true,
      text: { title: 'A made-up new title' },
    })
    expect(Object.keys(checked.preview!.definition).sort()).toEqual(['aboutYou', 'note', 'steps'])

    const published = await call('POST', `/api/admin/forms/${id}/publish`, {
      jwt: await publishToken(),
    })
    expect(published).toEqual({ status: 200, body: { ok: true, version: 2 } })
    expect((await call('GET', `/api/admin/forms/${id}/check`)).status).toBe(404)

    expect(
      await call('POST', `/api/admin/forms/${id}/status`, { body: { status: 'closed' } }),
    ).toEqual({ status: 200, body: { ok: true } })
    const after = (await call('GET', `/api/admin/forms/${id}`)).body!
    expect(after.form).toMatchObject({ status: 'closed', version: 2, hasDraft: false })

    const { results } = await env.DB.prepare(
      'SELECT action, actor FROM audit_log WHERE target_id = ? ORDER BY at, rowid',
    )
      .bind(id)
      .all()
    expect(results).toEqual([
      { action: 'publish_form_version', actor: ACTOR },
      { action: 'close_form', actor: ACTOR },
    ])
  })

  it('refuses a publish that needs a second approval, with the reason', async () => {
    const id = await freshApplication()
    const detail = (await call('GET', `/api/admin/forms/${id}`)).body!
    const text = structuredClone(detail.current!.text) as Text
    text['en-GB']!['fields.why_trustee.label'] = 'A made-up reworded question'
    await call('PUT', `/api/admin/forms/${id}/draft`, {
      body: { purpose: detail.current!.purpose, definition: detail.current!.definition, text },
    })
    const published = await call('POST', `/api/admin/forms/${id}/publish`, {
      jwt: await publishToken(),
    })
    expect(published.status).toBe(422)
    expect(published.body).toMatchObject({
      ok: false,
      error: 'checks_failed',
      check: { needsSecondApproval: true },
    })
  })

  it.each([
    ['not JSON', '{not json', 'application/json'],
    ['not an object', '[1, 2]', 'application/json'],
    ['the wrong content type', '{}', 'text/plain'],
  ])('refuses a draft body that is %s', async (_, body, contentType) => {
    const id = await freshApplication()
    const response = await call('PUT', `/api/admin/forms/${id}/draft`, { body, contentType })
    expect(response).toEqual({ status: 400, body: { ok: false, error: 'bad_request' } })
  })

  it('refuses a draft body over its limit before reading it all', async () => {
    const id = await freshApplication()
    const body = JSON.stringify({
      purpose: 'say_hello',
      definition: {},
      text: { x: 'x'.repeat(FORM_DRAFT_BODY_LIMIT) },
    })
    const response = await call('PUT', `/api/admin/forms/${id}/draft`, { body })
    expect(response.status).toBe(400)
    expect(
      await env.DB.prepare('SELECT 1 FROM form_drafts WHERE form_id = ?').bind(id).first(),
    ).toBeNull()
  })

  it('says not found for a form that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    expect((await call('GET', `/api/admin/forms/${missing}`)).status).toBe(404)
    expect((await call('GET', `/api/admin/forms/${missing}/check`)).status).toBe(404)
    expect(
      (await call('POST', `/api/admin/forms/${missing}/publish`, { jwt: await publishToken() }))
        .status,
    ).toBe(404)
    expect(
      (await call('POST', `/api/admin/forms/${missing}/status`, { body: { status: 'open' } }))
        .status,
    ).toBe(404)
  })
})

// Nadia's conditions on #160 (ADR-0010): publishing needs a fresh token from
// the publish Access application, which asks for MFA on every sign-in.
describe('the publish re-check', () => {
  async function readyToPublish() {
    const id = await freshApplication()
    const detail = (await call('GET', `/api/admin/forms/${id}`)).body!
    const text = structuredClone(detail.current!.text) as Text
    text['en-GB']!.title = 'A made-up title to publish'
    await call('PUT', `/api/admin/forms/${id}/draft`, {
      body: { purpose: detail.current!.purpose, definition: detail.current!.definition, text },
    })
    return id
  }

  async function version(id: string) {
    return (await call('GET', `/api/admin/forms/${id}`)).body!.form!.version
  }

  it('publishes with a fresh token from the publish application', async () => {
    const id = await readyToPublish()
    const published = await call('POST', `/api/admin/forms/${id}/publish`, {
      jwt: await publishToken(),
    })
    expect(published).toEqual({ status: 200, body: { ok: true, version: 2 } })
  })

  it.each([
    ['a main admin token', () => token()],
    ['a publish token issued over 5 minutes ago', () => publishToken({ iat: now() - 301 })],
    ['a publish token valid for over 10 minutes', () => publishToken({ exp: now() + 601 })],
    ['a publish token with no issue time', () => publishToken({ iat: undefined })],
  ])('asks for a fresh sign-in on %s, and publishes nothing', async (_, makeJwt) => {
    const id = await readyToPublish()
    const before = await auditCount()
    const refused = await call('POST', `/api/admin/forms/${id}/publish`, { jwt: await makeJwt() })
    expect(refused).toEqual({ status: 403, body: { ok: false, error: 'reauth_required' } })
    expect(await version(id)).toBe(1)
    expect(await auditCount()).toBe(before)
  })

  it('asks for a fresh sign-in on the publish page too', async () => {
    const id = await readyToPublish()
    expect(await call('GET', `/admin/forms/${id}/publish`)).toEqual({
      status: 403,
      body: { ok: false, error: 'reauth_required' },
    })
  })

  it('refuses a token that is neither, as for any admin route', async () => {
    const id = await readyToPublish()
    const other = await makeKey('key-unknown')
    const forged = await signToken(other, { aud: [PUBLISH_AUD], iat: now(), exp: now() + 300 })
    for (const jwt of [forged, 'not-a-token']) {
      const refused = await call('POST', `/api/admin/forms/${id}/publish`, { jwt })
      expect(refused).toEqual({ status: 403, body: { ok: false, error: 'forbidden' } })
    }
    expect(await version(id)).toBe(1)
  })

  it('is off where the publish application is not set up, failing closed', async () => {
    const id = await readyToPublish()
    const refused = await call('POST', `/api/admin/forms/${id}/publish`, {
      jwt: await publishToken(),
      publishAud: '',
    })
    expect(refused).toEqual({ status: 403, body: { ok: false, error: 'publishing_off' } })
    expect(await version(id)).toBe(1)
  })

  it('does not let a publish token into any other admin route', async () => {
    const refused = await call('GET', '/api/admin/forms', { jwt: await publishToken() })
    expect(refused).toEqual({ status: 403, body: { ok: false, error: 'forbidden' } })
  })

  it('still needs the request to come from our own admin page', async () => {
    const id = await readyToPublish()
    const refused = await call('POST', `/api/admin/forms/${id}/publish`, {
      jwt: await publishToken(),
      origin: 'https://example.com',
    })
    expect(refused.status).toBe(403)
    expect(await version(id)).toBe(1)
  })

  it('is checked by the route itself, not only the middleware', async () => {
    // The route mounted at a path the publish pattern doesn't match, with a
    // valid main admin token: the middleware lets it through, the route must not.
    const router = createRouter()
    router.post('/api/admin/other/:id/go', publishHandler)
    const instance = createApp()
    instance.use(adminAccess)
    instance.use(router)
    const id = await readyToPublish()
    const response = await toWebHandler(instance)(
      new Request(`${ORIGIN}/api/admin/other/${id}/go`, {
        method: 'POST',
        headers: { Origin: ORIGIN, 'Cf-Access-Jwt-Assertion': await token() },
      }),
      {
        cloudflare: {
          env: {
            DB: env.DB,
            SITE_ORIGIN: ORIGIN,
            KINMEET_ENV: 'staging',
            ACCESS_TEAM_DOMAIN: TEAM,
            ACCESS_AUD: AUD,
            ACCESS_PUBLISH_AUD: PUBLISH_AUD,
          },
        },
      },
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ ok: false, error: 'reauth_required' })
    expect(await version(id)).toBe(1)
  })
})

describe('the generic submissions list', () => {
  async function submit(formId: string, answers: Record<string, string>) {
    const id = crypto.randomUUID()
    await env.DB.prepare(
      `INSERT INTO form_submissions (id, submission_id, form_id, version, call_name, email, answers,
                                     received_at, delete_after)
       VALUES (?, ?, ?, 1, 'Test Fox', 'test.fox@example.com', ?, 1, 2)`,
    )
      .bind(id, crypto.randomUUID(), formId, JSON.stringify(answers))
      .run()
    return id
  }

  it('records the view, then lists answers labelled by their version', async () => {
    const formId = await freshApplication()
    const id = await submit(formId, {
      connection_to_founders: 'not_sure',
      why_trustee: 'A made-up reason.',
    })
    const before = await auditCount()
    const response = await call('GET', `/api/admin/forms/${formId}/submissions`)
    expect(response.status).toBe(200)
    expect(await auditCount()).toBe(before + 1)
    expect(response.body!.submissions).toEqual([
      {
        id,
        version: 1,
        callName: 'Test Fox',
        email: 'test.fox@example.com',
        answers: [
          {
            id: 'connection_to_founders',
            label: 'Sample wording for fields.connection_to_founders.label',
            text: 'Sample wording for fields.connection_to_founders.choices.not_sure',
          },
          {
            id: 'why_trustee',
            label: 'Sample wording for fields.why_trustee.label',
            text: 'A made-up reason.',
          },
        ],
        receivedAt: 1,
        repliedAt: null,
        outcomeToldAt: null,
        deleteAfter: 2,
        actions: expect.arrayContaining(['outcome_told', 'pass_to_safeguarding']),
      },
    ])
  })

  it('lists nothing and records nothing for a form that does not exist', async () => {
    const before = await auditCount()
    const response = await call(
      'GET',
      '/api/admin/forms/00000000-0000-4000-8000-000000000000/submissions',
    )
    expect(response).toEqual({ status: 404, body: { ok: false, error: 'not_found' } })
    expect(await auditCount()).toBe(before)
  })

  it('allows only the actions the version has', async () => {
    const formId = await freshApplication()
    const id = await submit(formId, { why_trustee: 'A made-up reason.' })
    // An application has no reply action; its retention moves on the outcome.
    expect((await call('POST', `/api/admin/submissions/${id}/replied`)).status).toBe(404)
    expect(await call('POST', `/api/admin/submissions/${id}/outcome-told`)).toEqual({
      status: 200,
      body: { ok: true },
    })
    // Only the first time counts.
    expect((await call('POST', `/api/admin/submissions/${id}/outcome-told`)).status).toBe(404)
    const row = await env.DB.prepare('SELECT outcome_told_at FROM form_submissions WHERE id = ?')
      .bind(id)
      .first<{ outcome_told_at: number | null }>()
    expect(row!.outcome_told_at).not.toBeNull()
  })
})
