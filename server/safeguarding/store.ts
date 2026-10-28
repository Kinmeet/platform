import type { D1Database } from '@cloudflare/workers-types'
import { auditLogDeleteAfter, nowSeconds } from '../utils/retention'
import { decryptRecord, encryptRecord, keyringFrom, type SafeguardingKeyring } from './crypto'

/**
 * The interim safeguarding store (#36), as the founder chose on #95: a table
 * in the main database holding only ciphertext, encrypted and decrypted here
 * in the Worker (./crypto.ts). It sits behind a small interface so the
 * hand-over and the acting lead's view (#93) never touch the table or the
 * key themselves.
 *
 * The rules every caller relies on: insert only, no delete; everything that
 * could identify someone is inside the ciphertext; every opening by a person
 * is audited before any text is returned; and nothing here ever logs
 * content.
 */

export type SourceForm = 'hello' | 'apply'

export interface HandedOverItem {
  /** The id of the row in the main database it came from. */
  id: string
  sourceForm: SourceForm
  /** The submission as it was sent, as JSON text. */
  content: string
  receivedAt: number
  handedOverAt: number
}

/** What the database shows in clear: the id and the hand-over time only. */
export type HandedOverSummary = Pick<HandedOverItem, 'id' | 'handedOverAt'>

export interface SafeguardingStore {
  /** Encrypts and adds an item. Does nothing if an item with this id already exists. */
  insert(item: HandedOverItem): Promise<void>
  /** Decrypts the stored copy, so the hand-over can check it before deleting the original. */
  readBack(
    id: string,
  ): Promise<Pick<HandedOverItem, 'sourceForm' | 'content' | 'receivedAt'> | null>
  /** Ids and hand-over times only, newest first, for the acting lead's list (#93). */
  list(): Promise<HandedOverSummary[]>
  /**
   * One whole item for a person to read (#93). Writes the audit entry first,
   * so text is never returned without one.
   */
  open(id: string, actor: string, now?: number): Promise<HandedOverItem | null>
}

/** The side of the store the admin hand-over may use: it writes and checks, never shows content. */
export type HandoverStore = Pick<SafeguardingStore, 'insert' | 'readBack'>

/** What is encrypted for each item. */
interface SealedFields {
  sourceForm: SourceForm
  receivedAt: number
  content: string
}

interface ItemRow {
  key_version: number
  iv: ArrayBuffer | number[]
  ciphertext: ArrayBuffer | number[]
  handed_over_at: number
}

// D1 returns a BLOB as an array of bytes.
const bytes = (value: ArrayBuffer | number[]) => new Uint8Array(value)

/** The encrypted store in the main database. Bound parameters only. */
export function encryptedStore(db: D1Database, keyring: SafeguardingKeyring): SafeguardingStore {
  async function read(id: string): Promise<HandedOverItem | null> {
    const row = await db
      .prepare(
        `SELECT key_version, iv, ciphertext, handed_over_at FROM safeguarding_items WHERE id = ?`,
      )
      .bind(id)
      .first<ItemRow>()
    if (row === null) return null
    const plaintext = await decryptRecord(keyring, id, {
      keyVersion: row.key_version,
      iv: bytes(row.iv),
      ciphertext: bytes(row.ciphertext),
    })
    const sealed = JSON.parse(plaintext) as SealedFields
    return { id, ...sealed, handedOverAt: row.handed_over_at }
  }

  return {
    async insert(item) {
      const sealed: SealedFields = {
        sourceForm: item.sourceForm,
        receivedAt: item.receivedAt,
        content: item.content,
      }
      const record = await encryptRecord(keyring, item.id, JSON.stringify(sealed))
      await db
        .prepare(
          `INSERT INTO safeguarding_items (id, key_version, iv, ciphertext, handed_over_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(item.id, record.keyVersion, record.iv, record.ciphertext, item.handedOverAt)
        .run()
    },
    async readBack(id) {
      const item = await read(id)
      return item === null
        ? null
        : { sourceForm: item.sourceForm, content: item.content, receivedAt: item.receivedAt }
    },
    async list() {
      const { results } = await db
        .prepare(
          `SELECT id, handed_over_at FROM safeguarding_items ORDER BY handed_over_at DESC, id`,
        )
        .all<{ id: string; handed_over_at: number }>()
      return results.map((row) => ({ id: row.id, handedOverAt: row.handed_over_at }))
    },
    async open(id, actor, now = nowSeconds()) {
      const audit = await db
        .prepare(
          `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
           SELECT ?, ?, ?, 'open_safeguarding_item', 'safeguarding_items', ?, ?
           WHERE EXISTS (SELECT 1 FROM safeguarding_items WHERE id = ?)`,
        )
        .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id)
        .run()
      if (audit.meta.changes !== 1) return null
      return read(id)
    },
  }
}

interface StoreEnv {
  DB?: D1Database
  SAFEGUARDING_KEY?: string
  SAFEGUARDING_KEY_PREVIOUS?: string
}

/**
 * The store for this environment, or `null` if the database or a usable key
 * is missing, so the safeguarding routes refuse rather than store anything
 * in clear (Nadia's condition 3). The only place in the code that reads the
 * key secrets.
 */
export async function storeFromEnv(env: object | undefined): Promise<SafeguardingStore | null> {
  const { DB, SAFEGUARDING_KEY, SAFEGUARDING_KEY_PREVIOUS } = (env ?? {}) as StoreEnv
  if (!DB) return null
  const keyring = await keyringFrom(SAFEGUARDING_KEY, SAFEGUARDING_KEY_PREVIOUS)
  return keyring ? encryptedStore(DB, keyring) : null
}
