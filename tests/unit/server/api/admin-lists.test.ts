import { env } from 'cloudflare:test'
import { createApp, toWebHandler } from 'h3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import applicationsHandler from '../../../../server/api/admin/applications.get'
import messagesHandler from '../../../../server/api/admin/messages.get'

// The two admin lists fail closed on their own (Theo, #51): reached without
// the admin middleware's verified identity, they serve nothing.
// Made-up test data only.
beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM form_submissions'),
    env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1',
               'Test Fox', 'test.fox@example.com', 'Made-up message.', 1, 2)`,
    ),
  ])
})

afterEach(() => vi.restoreAllMocks())

describe('admin lists without the admin middleware', () => {
  for (const [path, handler] of [
    ['/api/admin/messages', messagesHandler],
    ['/api/admin/applications', applicationsHandler],
  ] as const) {
    it(`${path} serves nothing`, async () => {
      const app = createApp()
      app.use(path, handler)
      const response = await toWebHandler(app)(new Request(`https://example.com${path}`), {
        cloudflare: { env: { DB: env.DB } },
      })
      expect(response.status).toBe(500)
      const body = await response.text()
      for (const value of ['Test Fox', 'test.fox@example.com', 'Made-up message.']) {
        expect(body).not.toContain(value)
      }
    })
  }
})

describe('admin lists with a verified identity', () => {
  const ACTOR = '00000000-0000-4000-8000-00000000f00d'
  // Each list now shows the submissions of its forms (ADR-0010, #156), so
  // each entry names the form (say hello, or the one open application form),
  // never a row.
  const action = 'view_form_submissions'
  for (const [path, handler, form] of [
    ['/api/admin/messages', messagesHandler, 'hello'],
    ['/api/admin/applications', applicationsHandler, 'trustee'],
  ] as const) {
    it(`${path} records one view entry per fetch`, async () => {
      const app = createApp()
      app.use(path, handler)
      const formId = (await env.DB.prepare('SELECT id FROM forms WHERE slug = ?')
        .bind(form)
        .first<{ id: string }>())!.id
      const count = async () =>
        (
          await env.DB.prepare('SELECT count(*) AS n FROM audit_log WHERE action = ? AND actor = ?')
            .bind(action, ACTOR)
            .first<{ n: number }>()
        )?.n ?? 0
      const before = await count()
      const context = {
        cloudflare: { env: { DB: env.DB } },
        adminIdentity: { sub: ACTOR },
      }
      for (let i = 0; i < 2; i++) {
        const response = await toWebHandler(app)(new Request(`https://example.com${path}`), context)
        expect(response.status).toBe(200)
      }
      expect(await count()).toBe(before + 2)
      const { results } = await env.DB.prepare(
        'SELECT target_table, target_id FROM audit_log WHERE action = ? AND actor = ? ORDER BY rowid',
      )
        .bind(action, ACTOR)
        .all<{ target_table: string; target_id: string | null }>()
      // Only this list's two entries are new, and both name its form.
      expect(results.slice(before)).toEqual([
        { target_table: 'forms', target_id: formId },
        { target_table: 'forms', target_id: formId },
      ])
    })
  }
})
