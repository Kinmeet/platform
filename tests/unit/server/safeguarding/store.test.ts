import { env } from 'cloudflare:test'
import { beforeEach, describe, expect, it } from 'vitest'
import { handOver } from '../../../../server/safeguarding/handover'
import {
  storeFromEnv,
  type HandedOverItem,
  type SafeguardingStore,
} from '../../../../server/safeguarding/store'
import { deleteExpiredRows } from '../../../../server/utils/db/deletion'
import { makeTestKey } from './test-key'

// The encrypted store (#36, #95) and the hand-over working through the
// interface alone. Made-up test data only. The store refuses deletes, so
// each test uses fresh ids.
const RECEIVED = 1_793_000_000
const ACTOR = '00000000-0000-4000-8000-00000000f00d'
const SECRET_WORDS = ['Test Fox', 'test.fox@example.com', 'Made-up disclosure.', 'hello']

let ids: string[]
let key: string

beforeEach(() => {
  ids = [crypto.randomUUID(), crypto.randomUUID()]
  key = makeTestKey()
})

const item = (id: string, handedOverAt: number): HandedOverItem => ({
  id,
  sourceForm: 'hello',
  content: JSON.stringify({
    callName: 'Test Fox',
    email: 'test.fox@example.com',
    message: 'Made-up disclosure.',
  }),
  receivedAt: RECEIVED,
  handedOverAt,
})

async function store(secret = key): Promise<SafeguardingStore> {
  const made = await storeFromEnv({ DB: env.DB, SAFEGUARDING_KEY: secret })
  if (!made) throw new Error('store not set up')
  return made
}

async function rawRow(id: string) {
  return env.DB.prepare('SELECT * FROM safeguarding_items WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>()
}

async function openAudit(id: string) {
  const { results } = await env.DB.prepare(
    `SELECT actor, action, target_table, target_id FROM audit_log
     WHERE action = 'open_safeguarding_item' AND target_id = ?`,
  )
    .bind(id)
    .all()
  return results
}

describe('the encrypted store', () => {
  it('inserts once, and reads back, opens and lists what was stored', async () => {
    const s = await store()
    await s.insert(item(ids[0]!, RECEIVED + 10))
    await s.insert({ ...item(ids[0]!, RECEIVED + 99), content: '{"other":"Made-up."}' })
    await s.insert(item(ids[1]!, RECEIVED + 20))

    expect(await s.readBack(ids[0]!)).toEqual({
      sourceForm: 'hello',
      content: item(ids[0]!, 0).content,
      receivedAt: RECEIVED,
    })
    expect(await s.open(ids[0]!, ACTOR, RECEIVED + 30)).toEqual(item(ids[0]!, RECEIVED + 10))
    const listed = (await s.list()).filter((summary) => ids.includes(summary.id))
    expect(listed).toEqual([
      { id: ids[1], handedOverAt: RECEIVED + 20 },
      { id: ids[0], handedOverAt: RECEIVED + 10 },
    ])
  })

  it('holds only the id, key version, IV, ciphertext and hand-over time in clear', async () => {
    await (await store()).insert(item(ids[0]!, RECEIVED + 10))
    const row = await rawRow(ids[0]!)
    expect(Object.keys(row!).sort()).toEqual(
      ['ciphertext', 'handed_over_at', 'id', 'iv', 'key_version'].sort(),
    )
    expect(row!.key_version).toBe(1)
    const stored = new TextDecoder().decode(new Uint8Array(row!.ciphertext as number[]))
    for (const word of [...SECRET_WORDS, String(RECEIVED)]) expect(stored).not.toContain(word)
    expect(JSON.stringify(row)).not.toContain('Made-up')
  })

  it('writes an audit entry before returning an opened item, and none for an unknown id', async () => {
    const s = await store()
    await s.insert(item(ids[0]!, RECEIVED + 10))
    expect(await openAudit(ids[0]!)).toEqual([])
    await s.open(ids[0]!, ACTOR, RECEIVED + 30)
    expect(await openAudit(ids[0]!)).toEqual([
      {
        actor: ACTOR,
        action: 'open_safeguarding_item',
        target_table: 'safeguarding_items',
        target_id: ids[0],
      },
    ])
    expect(await s.open(ids[1]!, ACTOR, RECEIVED + 30)).toBeNull()
    expect(await openAudit(ids[1]!)).toEqual([])
  })

  it('records the opening even when the item cannot be decrypted', async () => {
    await (await store()).insert(item(ids[0]!, RECEIVED + 10))
    const other = await store(makeTestKey())
    await expect(other.open(ids[0]!, ACTOR, RECEIVED + 30)).rejects.toThrow(
      /^safeguarding_decrypt_failed$/,
    )
    expect(await openAudit(ids[0]!)).toHaveLength(1)
  })

  it('answers null for an unknown id', async () => {
    expect(await (await store()).readBack(ids[0]!)).toBeNull()
  })

  it('refuses every delete, and every update except re-encrypting under a newer key', async () => {
    await (await store()).insert(item(ids[0]!, RECEIVED + 10))
    await expect(
      env.DB.prepare('DELETE FROM safeguarding_items WHERE id = ?').bind(ids[0]!).run(),
    ).rejects.toThrow(/safeguarding_items_insert_only/)
    for (const change of [
      'handed_over_at = handed_over_at + 1',
      'ciphertext = zeroblob(40)',
      'key_version = 1',
    ]) {
      await expect(
        env.DB.prepare(`UPDATE safeguarding_items SET ${change} WHERE id = ?`).bind(ids[0]!).run(),
      ).rejects.toThrow(/safeguarding_items_insert_only/)
    }
    // A rotation (docs/runbooks/rotate-safeguarding-key.md) moves the version on.
    await env.DB.prepare('UPDATE safeguarding_items SET key_version = 2 WHERE id = ?')
      .bind(ids[0]!)
      .run()
  })

  it('is never touched by the deletion job', async () => {
    await (await store()).insert(item(ids[0]!, RECEIVED + 10))
    // Far beyond any deletion date.
    await deleteExpiredRows(env.DB, RECEIVED + 100 * 365 * 24 * 60 * 60)
    expect(await rawRow(ids[0]!)).not.toBeNull()
    const { results } = await env.DB.prepare(
      `SELECT name FROM pragma_table_info('safeguarding_items')`,
    ).all<{ name: string }>()
    expect(results.map((row) => row.name)).not.toContain('delete_after')
  })
})

describe('setting the store up', () => {
  it('needs the database and a well-formed key', async () => {
    expect(await storeFromEnv(undefined)).toBeNull()
    expect(await storeFromEnv({ DB: env.DB })).toBeNull()
    expect(await storeFromEnv({ SAFEGUARDING_KEY: key })).toBeNull()
    expect(await storeFromEnv({ DB: env.DB, SAFEGUARDING_KEY: 'not-a-key' })).toBeNull()
    expect(
      await storeFromEnv({ DB: env.DB, SAFEGUARDING_KEY: key, SAFEGUARDING_KEY_PREVIOUS: 'x' }),
    ).toBeNull()
    expect(await storeFromEnv({ DB: env.DB, SAFEGUARDING_KEY: key })).not.toBeNull()
  })

  it('reads items under the previous key during a rotation', async () => {
    await (await store()).insert(item(ids[0]!, RECEIVED + 10))
    const rotated = await storeFromEnv({
      DB: env.DB,
      SAFEGUARDING_KEY: makeTestKey(2),
      SAFEGUARDING_KEY_PREVIOUS: key,
    })
    expect((await rotated!.readBack(ids[0]!))?.content).toBe(item(ids[0]!, 0).content)
  })
})

describe('the hand-over through the interface alone', () => {
  it('works with any store that keeps the interface', async () => {
    const kept = new Map<string, HandedOverItem>()
    const elsewhere: SafeguardingStore = {
      async insert(next) {
        if (!kept.has(next.id)) kept.set(next.id, next)
      },
      async readBack(id) {
        const found = kept.get(id)
        return found
          ? { sourceForm: found.sourceForm, content: found.content, receivedAt: found.receivedAt }
          : null
      },
      async list() {
        throw new Error('not used by the hand-over')
      },
      async open() {
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
