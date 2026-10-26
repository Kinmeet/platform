import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handOver } from '../../../../server/safeguarding/handover'
import { d1Store } from '../../../../server/safeguarding/store'
import {
  listApplications,
  listHelloMessages,
  markOutcomeTold,
  markReplied,
} from '../../../../server/utils/db/admin'

// Made-up test data only.
const RECEIVED = 1_793_000_000
const NOW = RECEIVED + 3 * 24 * 60 * 60
const ACTOR = '00000000-0000-4000-8000-00000000f00d'
// The store refuses every delete, so it cannot be emptied between tests.
// Each test uses fresh ids instead and looks only at its own items.
let HELLO_ID: string
let OTHER_HELLO_ID: string
let APPLICATION_ID: string
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000dead'
const SECRET_WORDS = [
  'Test Fox',
  'test.fox@example.com',
  'Made-up disclosure.',
  'Sample Applicant',
  'sample@example.org',
  'Made-up answer.',
]

beforeEach(async () => {
  HELLO_ID = crypto.randomUUID()
  OTHER_HELLO_ID = crypto.randomUUID()
  APPLICATION_ID = crypto.randomUUID()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM hello_messages'),
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, ?, 'Test Fox', 'test.fox@example.com', 'Made-up disclosure.', ?, ?),
              (?, ?, 'Test Owl', 'test.owl@example.com', 'Made-up hello.', ?, ?)`,
    ).bind(
      HELLO_ID,
      crypto.randomUUID(),
      RECEIVED,
      RECEIVED + 1000,
      OTHER_HELLO_ID,
      crypto.randomUUID(),
      RECEIVED,
      RECEIVED + 1000,
    ),
    env.DB.prepare(
      `INSERT INTO applications (id, submission_id, role, connection_to_founders, call_name, email,
                                 answers, received_at, delete_after)
       VALUES (?, ?, 'trustee', 'no', 'Sample Applicant', 'sample@example.org',
               '{"why_trustee":"Made-up answer."}', ?, ?)`,
    ).bind(APPLICATION_ID, crypto.randomUUID(), RECEIVED, RECEIVED + 99999),
  ])
})

const store = () => d1Store(env.SAFEGUARDING_DB)

async function items() {
  const { results } = await env.SAFEGUARDING_DB.prepare(
    `SELECT id, source_form, content, received_at, handed_over_at FROM handed_over_items
     WHERE id IN (?, ?, ?) ORDER BY id`,
  )
    .bind(HELLO_ID, OTHER_HELLO_ID, APPLICATION_ID)
    .all<{
      id: string
      source_form: string
      content: string
      received_at: number
      handed_over_at: number
    }>()
  return results
}

async function handOverAudit() {
  const { results } = await env.DB.prepare(
    `SELECT * FROM audit_log WHERE action = 'pass_to_safeguarding' AND target_id IN (?, ?, ?)
     ORDER BY rowid`,
  )
    .bind(HELLO_ID, OTHER_HELLO_ID, APPLICATION_ID)
    .all()
  return results
}

/** A database whose every statement fails, to stand in for an outage. */
const broken = {
  prepare() {
    throw new Error('made_up_outage')
  },
  batch() {
    throw new Error('made_up_outage')
  },
} as unknown as D1Database

/** The main database, but its batch (delete plus audit entry) fails. */
const mainWithFailingBatch = new Proxy(env.DB, {
  get(target, key) {
    if (key === 'batch') return () => Promise.reject(new Error('made_up_outage'))
    const value = Reflect.get(target, key) as unknown
    return typeof value === 'function' ? value.bind(target) : value
  },
})

describe('pass to safeguarding', () => {
  it('moves a message into the store, out of the main database, with one audit entry', async () => {
    expect(await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)).toBe('handed_over')
    expect(await items()).toEqual([
      {
        id: HELLO_ID,
        source_form: 'hello',
        content: JSON.stringify({
          callName: 'Test Fox',
          email: 'test.fox@example.com',
          message: 'Made-up disclosure.',
        }),
        received_at: RECEIVED,
        handed_over_at: NOW,
      },
    ])
    const left = await env.DB.prepare('SELECT id FROM hello_messages').all<{ id: string }>()
    expect(left.results.map((row) => row.id)).toEqual([OTHER_HELLO_ID])
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).toEqual([OTHER_HELLO_ID])
    const audit = await handOverAudit()
    expect(audit).toHaveLength(1)
    expect(audit[0]).toMatchObject({
      at: NOW,
      actor: ACTOR,
      action: 'pass_to_safeguarding',
      target_table: 'hello_messages',
      target_id: HELLO_ID,
    })
  })

  it('moves an application with its answers', async () => {
    expect(await handOver(env.DB, store(), 'apply', APPLICATION_ID, ACTOR, NOW)).toBe('handed_over')
    const [item] = await items()
    expect(item!.source_form).toBe('apply')
    expect(JSON.parse(item!.content)).toEqual({
      role: 'trustee',
      callName: 'Sample Applicant',
      email: 'sample@example.org',
      answers: { why_trustee: 'Made-up answer.' },
    })
    expect(await listApplications(env.DB)).toEqual([])
    expect((await handOverAudit())[0]).toMatchObject({
      target_table: 'applications',
      target_id: APPLICATION_ID,
    })
  })

  it('writes nothing from the row into the audit log', async () => {
    await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)
    await handOver(env.DB, store(), 'apply', APPLICATION_ID, ACTOR, NOW)
    const text = JSON.stringify(await handOverAudit())
    for (const word of [...SECRET_WORDS, 'trustee']) expect(text).not.toContain(word)
  })

  it('counts only once', async () => {
    await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)
    expect(await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW + 100)).toBe('not_found')
    expect(await items()).toHaveLength(1)
    expect(await handOverAudit()).toHaveLength(1)
  })

  it('changes nothing for an unknown row, or an id from the other form', async () => {
    expect(await handOver(env.DB, store(), 'hello', UNKNOWN_ID, ACTOR, NOW)).toBe('not_found')
    expect(await handOver(env.DB, store(), 'apply', HELLO_ID, ACTOR, NOW)).toBe('not_found')
    expect(await items()).toEqual([])
    expect(await handOverAudit()).toEqual([])
    expect(
      await env.SAFEGUARDING_DB.prepare('SELECT 1 FROM handed_over_items WHERE id = ?')
        .bind(UNKNOWN_ID)
        .first(),
    ).toBeNull()
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).toContain(HELLO_ID)
  })

  it('leaves no other action able to reach a passed row', async () => {
    await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)
    await handOver(env.DB, store(), 'apply', APPLICATION_ID, ACTOR, NOW)
    expect(await markReplied(env.DB, HELLO_ID, ACTOR, NOW + 100)).toBe(false)
    expect(await markOutcomeTold(env.DB, APPLICATION_ID, ACTOR, NOW + 100)).toBe(false)
    const { results } = await env.DB.prepare(
      `SELECT action FROM audit_log WHERE action != 'pass_to_safeguarding' AND target_id IN (?, ?)`,
    )
      .bind(HELLO_ID, APPLICATION_ID)
      .all()
    expect(results).toEqual([])
  })
})

describe('a failure part-way', () => {
  it('leaves the row where it was if the store cannot be written', async () => {
    await expect(handOver(env.DB, d1Store(broken), 'hello', HELLO_ID, ACTOR, NOW)).rejects.toThrow()
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).toContain(HELLO_ID)
    expect(await handOverAudit()).toEqual([])
  })

  it('keeps the row, and a retry finishes the move without a second copy', async () => {
    await expect(
      handOver(mainWithFailingBatch, store(), 'hello', HELLO_ID, ACTOR, NOW),
    ).rejects.toThrow()
    // Copied, but still in the main database: visible and retryable.
    expect(await items()).toHaveLength(1)
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).toContain(HELLO_ID)
    expect(await handOverAudit()).toEqual([])

    expect(await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW + 60)).toBe('handed_over')
    const stored = await items()
    expect(stored).toHaveLength(1)
    // The first copy stands, with its own hand-over time.
    expect(stored[0]!.handed_over_at).toBe(NOW)
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).not.toContain(HELLO_ID)
    expect(await handOverAudit()).toHaveLength(1)
  })

  it('refuses to delete the row if the copy in the store does not match', async () => {
    await env.SAFEGUARDING_DB.prepare(
      `INSERT INTO handed_over_items (id, source_form, content, received_at, handed_over_at)
       VALUES (?, 'hello', '{"message":"Something else."}', ?, ?)`,
    )
      .bind(HELLO_ID, RECEIVED, NOW)
      .run()
    await expect(handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)).rejects.toThrow(
      /handover_copy_mismatch/,
    )
    expect((await listHelloMessages(env.DB)).map((m) => m.id)).toContain(HELLO_ID)
    expect(await handOverAudit()).toEqual([])
  })
})

describe('the safeguarding store', () => {
  it('refuses every update and delete', async () => {
    await handOver(env.DB, store(), 'hello', HELLO_ID, ACTOR, NOW)
    await expect(
      env.SAFEGUARDING_DB.prepare(`UPDATE handed_over_items SET content = '{}'`).run(),
    ).rejects.toThrow(/handed_over_items_insert_only/)
    await expect(
      env.SAFEGUARDING_DB.prepare('DELETE FROM handed_over_items').run(),
    ).rejects.toThrow(/handed_over_items_insert_only/)
    expect(await items()).toHaveLength(1)
  })

  it('has no deletion date: retention is set by area 2', async () => {
    const { results } = await env.SAFEGUARDING_DB.prepare(
      `SELECT name FROM pragma_table_info('handed_over_items')`,
    ).all<{ name: string }>()
    expect(results.map((row) => row.name)).toEqual([
      'id',
      'source_form',
      'content',
      'received_at',
      'handed_over_at',
    ])
  })

  it('is not the main database', async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE name = 'handed_over_items'`,
    ).all()
    expect(results).toEqual([])
  })
})
