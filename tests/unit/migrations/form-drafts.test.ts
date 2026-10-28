import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// 0008: the form builder's drafts and audit actions (ADR-0010 phase B, #160).
// Made-up test data only.

const AT = 1_793_300_000

async function helloId(): Promise<string> {
  return (await env.DB.prepare(`SELECT id FROM forms WHERE slug = 'hello'`).first<{
    id: string
  }>())!.id
}

function entry(action: string, table: string, target: string | null) {
  return env.DB.prepare(
    `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
     VALUES (?, ?, 'test-actor', ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), AT, action, table, target, AT + 1)
    .run()
}

describe('the audit log after 0008', () => {
  it.each(['create_form', 'publish_form_version', 'open_form', 'close_form'])(
    'takes %s, naming a form',
    async (action) => {
      await entry(action, 'forms', await helloId())
    },
  )

  it.each(['create_form', 'publish_form_version', 'open_form', 'close_form'])(
    'refuses %s on another table or with no form named',
    async (action) => {
      await expect(entry(action, 'form_submissions', await helloId())).rejects.toThrow()
      await expect(entry(action, 'forms', null)).rejects.toThrow()
    },
  )

  it('refuses an action it does not know', async () => {
    await expect(entry('save_form_draft', 'forms', await helloId())).rejects.toThrow()
  })

  it('is still append-only', async () => {
    const id = await helloId()
    await entry('open_form', 'forms', id)
    await expect(
      env.DB.prepare(`UPDATE audit_log SET actor = 'someone-else' WHERE target_id = ?`)
        .bind(id)
        .run(),
    ).rejects.toThrow(/audit_log_append_only/)
  })
})

describe('form drafts', () => {
  const save = (formId: string, definition: string, text: string, by = 'test-actor') =>
    env.DB.prepare(
      `INSERT INTO form_drafts (form_id, purpose, definition, text, updated_at, updated_by)
       VALUES (?, 'say_hello', ?, ?, ?, ?)`,
    )
      .bind(formId, definition, text, AT, by)
      .run()

  it('keeps one draft per form', async () => {
    const id = await helloId()
    await save(id, '{}', '{}')
    await expect(save(id, '{}', '{}')).rejects.toThrow()
  })

  it.each([
    ['a definition that is not JSON', 'not json', '{}'],
    ['a definition that is not an object', '[]', '{}'],
    ['text that is not an object', '{}', '"hello"'],
    ['a definition over 32 KB', JSON.stringify({ x: 'x'.repeat(32 * 1024) }), '{}'],
    ['text over 64 KB', '{}', JSON.stringify({ x: 'x'.repeat(64 * 1024) })],
  ])('refuses %s', async (_, definition, text) => {
    await expect(save(await helloId(), definition, text)).rejects.toThrow()
  })

  it('refuses no saver, and a purpose that is not plain', async () => {
    const id = await helloId()
    await expect(save(id, '{}', '{}', '')).rejects.toThrow()
    await expect(
      env.DB.prepare(
        `INSERT INTO form_drafts (form_id, purpose, definition, text, updated_at, updated_by)
         VALUES (?, 'Say Hello', '{}', '{}', ?, 'test-actor')`,
      )
        .bind(id, AT)
        .run(),
    ).rejects.toThrow()
  })
})
