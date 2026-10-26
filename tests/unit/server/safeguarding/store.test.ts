import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handOver } from '../../../../server/safeguarding/handover'
import {
  d1Store,
  storeFromEnv,
  type HandedOverItem,
  type SafeguardingStore,
} from '../../../../server/safeguarding/store'

// The store interface (#36, #95): the D1 implementation, and the hand-over
// working through the interface alone, as a future service-binding store
// would. Made-up test data only. The store refuses deletes, so each test
// uses fresh ids.
const RECEIVED = 1_793_000_000

let ids: string[]

beforeEach(() => {
  ids = [crypto.randomUUID(), crypto.randomUUID()]
})

const item = (id: string, handedOverAt: number): HandedOverItem => ({
  id,
  sourceForm: 'hello',
  content: JSON.stringify({ message: 'Made-up disclosure.' }),
  receivedAt: RECEIVED,
  handedOverAt,
})

describe('the D1 store', () => {
  it('inserts once, and reads back, gets and lists what was stored', async () => {
    const store = d1Store(env.SAFEGUARDING_DB)
    await store.insert(item(ids[0]!, RECEIVED + 10))
    await store.insert({ ...item(ids[0]!, RECEIVED + 99), content: '{"other":"Made-up."}' })
    await store.insert(item(ids[1]!, RECEIVED + 20))

    expect(await store.readBack(ids[0]!)).toEqual({
      sourceForm: 'hello',
      content: item(ids[0]!, 0).content,
    })
    expect(await store.get(ids[0]!)).toEqual(item(ids[0]!, RECEIVED + 10))
    const listed = (await store.list()).filter((summary) => ids.includes(summary.id))
    expect(listed).toEqual([
      { id: ids[1], sourceForm: 'hello', receivedAt: RECEIVED, handedOverAt: RECEIVED + 20 },
      { id: ids[0], sourceForm: 'hello', receivedAt: RECEIVED, handedOverAt: RECEIVED + 10 },
    ])
    // The list never carries content.
    expect(JSON.stringify(listed)).not.toContain('Made-up')
  })

  it('answers null for an unknown id', async () => {
    const store = d1Store(env.SAFEGUARDING_DB)
    expect(await store.readBack(ids[0]!)).toBeNull()
    expect(await store.get(ids[0]!)).toBeNull()
  })

  it('is set up only when the binding is there', () => {
    expect(storeFromEnv(undefined)).toBeNull()
    expect(storeFromEnv({})).toBeNull()
    expect(storeFromEnv({ SAFEGUARDING_DB: env.SAFEGUARDING_DB })).not.toBeNull()
  })
})

describe('the hand-over through the interface alone', () => {
  it('works with any store that keeps the interface, such as one behind a service binding', async () => {
    const kept = new Map<string, HandedOverItem>()
    const elsewhere: SafeguardingStore = {
      async insert(next) {
        if (!kept.has(next.id)) kept.set(next.id, next)
      },
      async readBack(id) {
        const found = kept.get(id)
        return found ? { sourceForm: found.sourceForm, content: found.content } : null
      },
      async list() {
        throw new Error('not used by the hand-over')
      },
      async get() {
        throw new Error('not used by the hand-over')
      },
    }
    const id = ids[0]!
    await env.DB.prepare(
      `INSERT INTO hello_messages (id, submission_id, call_name, email, message, received_at, delete_after)
       VALUES (?, ?, 'Test Fox', 'test.fox@example.com', 'Made-up disclosure.', ?, ?)`,
    )
      .bind(id, crypto.randomUUID(), RECEIVED, RECEIVED + 1000)
      .run()

    expect(await handOver(env.DB, elsewhere, 'hello', id, 'test-actor', RECEIVED + 5)).toBe(
      'handed_over',
    )
    expect(kept.get(id)?.handedOverAt).toBe(RECEIVED + 5)
    expect(
      await env.DB.prepare('SELECT 1 FROM hello_messages WHERE id = ?').bind(id).first(),
    ).toBeNull()
  })
})
