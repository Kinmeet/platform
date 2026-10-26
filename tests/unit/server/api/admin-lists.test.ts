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
