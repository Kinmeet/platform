import { env } from 'cloudflare:test'
import { createApp, createRouter, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import handler from '../../../../server/api/forms/[slug].get'

// GET /api/forms/<slug> (ADR-0010, A2): an open form's steps and wording for
// its page, and nothing about who reads the answers. Made-up test data only.

async function get(slug: string) {
  const app = createApp()
  app.use(createRouter().get('/api/forms/:slug', handler))
  const response = await toWebHandler(app)(
    new Request(`https://example.com/api/forms/${encodeURIComponent(slug)}`),
    { cloudflare: { env: { DB: env.DB } } },
  )
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

let errors: MockInstance<typeof console.error>
beforeEach(() => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe('an open form', () => {
  it('serves say hello: its steps, "About you" and wording', async () => {
    const { status, body } = await get('hello')
    expect(status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      form: {
        slug: 'hello',
        kind: 'form',
        version: 1,
        definition: { aboutYou: 0, note: false },
        text: { title: 'Say hello', 'fields.message.label': 'Your message' },
      },
    })
  })

  it('serves the trustee application on its current version', async () => {
    const { status, body } = await get('trustee')
    expect(status).toBe(200)
    const form = body.form as { version: number; definition: { steps: { id: string }[] } }
    expect(form.version).toBe(2)
    expect(form.definition.steps.map((step) => step.id)).toEqual(['checks', 'answers'])
  })

  it('never says who reads the answers, what happens to them or how long they are kept', async () => {
    for (const slug of ['hello', 'trustee']) {
      const { body } = await get(slug)
      const form = body.form as { definition: Record<string, unknown> }
      expect(Object.keys(form).sort()).toEqual(['definition', 'kind', 'slug', 'text', 'version'])
      expect(Object.keys(form.definition).sort()).toEqual(['aboutYou', 'note', 'steps'])
      const json = JSON.stringify(body)
      for (const word of ['readers', 'actions', 'receipt', 'retention', 'purpose', 'secretary'])
        expect(json).not.toContain(word)
    }
  })
})

describe('a form that is not open', () => {
  it.each(['treasurer', 'not-a-form', 'HELLO-there', ''])('%s is 404', async (slug) => {
    const { status, body } = await get(slug || 'x'.repeat(200))
    expect(status).toBe(404)
    expect(body).toEqual({ ok: false, error: 'not_found' })
  })

  it('a closed form is 404', async () => {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, 'closed-form', 'form', 'draft', 1)`,
      ).bind(id),
      env.DB.prepare(
        `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
         SELECT ?, 1, purpose, definition, text, 1, 'test-actor' FROM form_versions
         WHERE form_id = (SELECT id FROM forms WHERE slug = 'hello') AND version = 1`,
      ).bind(id),
      env.DB.prepare(`UPDATE forms SET status = 'closed', current_version = 1 WHERE id = ?`).bind(
        id,
      ),
    ])
    expect((await get('closed-form')).status).toBe(404)
  })
})

describe('a stored version that fails its checks', () => {
  async function store(slug: string, text: string) {
    const id = crypto.randomUUID()
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, 'form', 'draft', 1)`,
      ).bind(id, slug),
      env.DB.prepare(
        `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
         SELECT ?, 1, purpose, definition, ?, 1, 'test-actor' FROM form_versions
         WHERE form_id = (SELECT id FROM forms WHERE slug = 'hello') AND version = 1`,
      ).bind(id, text),
      env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
    ])
  }

  it('is 503 when a label is missing, and logs a code only', async () => {
    await store('sample-missing', JSON.stringify({ 'en-GB': { title: 'Sample form' } }))
    const { status, body } = await get('sample-missing')
    expect(status).toBe(503)
    expect(body).toEqual({ ok: false, error: 'unavailable' })
    expect(errors).toHaveBeenCalledWith(JSON.stringify({ code: 'form_read_unavailable' }))
  })

  it('is 503 when the text has a key the version does not have', async () => {
    await store(
      'sample-unknown',
      JSON.stringify({
        'en-GB': {
          title: 'Sample form',
          'fields.message.label': 'Your message',
          'fields.message.summary': 'Your message',
          'fields.injected.label': 'Something else',
        },
      }),
    )
    expect((await get('sample-unknown')).status).toBe(503)
  })
})
