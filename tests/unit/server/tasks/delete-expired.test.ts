import { env } from 'cloudflare:test'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// The deletion task itself (#31, Kit's and Theo's reviews of #50): finding
// DB in the task context, the two failure paths, and a log that holds a
// code and counts only. Made-up test data only.
interface Task {
  run(event: { context: unknown }): Promise<{ result: unknown }>
}

let task: Task
let errors: ReturnType<typeof vi.spyOn>
let logs: ReturnType<typeof vi.spyOn>

beforeAll(async () => {
  // Nitro provides defineTask as a global in the built app.
  ;(globalThis as { defineTask?: (definition: Task) => Task }).defineTask = (definition) =>
    definition
  task = (await import('../../../../server/tasks/retention/delete-expired')).default as Task
})

beforeEach(async () => {
  errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  logs = vi.spyOn(console, 'log').mockImplementation(() => {})
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

const withDb = (db: unknown) => ({ context: { cloudflare: { env: { DB: db } } } })

describe('the deletion task', () => {
  it('finds DB in the task context, deletes and logs counts only', async () => {
    const { result } = await task.run(withDb(env.DB))
    expect(result).toEqual({ hello_messages: 1, applications: 0, email_log: 0, audit_log: 0 })
    expect(logs.mock.calls).toEqual([
      [
        JSON.stringify({
          code: 'deletion_done',
          deleted: { hello_messages: 1, applications: 0, email_log: 0, audit_log: 0 },
        }),
      ],
    ])
    expect(errors).not.toHaveBeenCalled()
  })

  it('throws, after logging a code, when DB is missing', async () => {
    await expect(task.run({ context: {} })).rejects.toThrow('deletion_db_missing')
    await expect(task.run({ context: { cloudflare: { env: {} } } })).rejects.toThrow(
      'deletion_db_missing',
    )
    expect(errors.mock.calls).toEqual([
      [JSON.stringify({ code: 'deletion_db_missing' })],
      [JSON.stringify({ code: 'deletion_db_missing' })],
    ])
  })

  it('throws, after logging only a code, when the batch fails', async () => {
    const failing = new Proxy(env.DB, {
      get(target, key) {
        if (key === 'batch') {
          return () => Promise.reject(new Error('made_up_failure mentioning test.fox@example.com'))
        }
        const value = Reflect.get(target, key) as unknown
        return typeof value === 'function' ? value.bind(target) : value
      },
    })
    await expect(task.run(withDb(failing))).rejects.toThrow('deletion_failed')
    expect(errors.mock.calls).toEqual([[JSON.stringify({ code: 'deletion_failed' })]])
    expect(logs).not.toHaveBeenCalled()
    // Nothing from the underlying error, which could quote a row, reaches the log.
    expect(JSON.stringify(errors.mock.calls)).not.toContain('example.com')
  })
})
