import type { D1Database } from '@cloudflare/workers-types'

/**
 * The interim safeguarding store (#36), behind a small interface so that
 * where it lives can change without touching the hand-over or the acting
 * lead's view (#93). Today it is a D1 database bound to this Worker as
 * SAFEGUARDING_DB. If the safeguarding databases move to their own
 * Cloudflare account (#95), a second implementation of this interface will
 * call a small Worker there through a service binding instead, and only
 * `storeFromEnv` changes.
 *
 * Every implementation keeps the same rules: insert only, no update or
 * delete, and nothing here ever logs content.
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

export type HandedOverSummary = Omit<HandedOverItem, 'content'>

export interface SafeguardingStore {
  /** Adds an item. Does nothing if an item with this id already exists. */
  insert(item: HandedOverItem): Promise<void>
  /** The stored form and content for an id, so the hand-over can check its copy. */
  readBack(id: string): Promise<Pick<HandedOverItem, 'sourceForm' | 'content'> | null>
  /** Ids and dates only, newest first, for the acting lead's list (#93). */
  list(): Promise<HandedOverSummary[]>
  /** One whole item, for the acting lead's view (#93). */
  get(id: string): Promise<HandedOverItem | null>
}

/** The side of the store the admin hand-over may use: it writes and checks, never reads content out. */
export type HandoverStore = Pick<SafeguardingStore, 'insert' | 'readBack'>

interface ItemRow {
  id: string
  source_form: SourceForm
  content: string
  received_at: number
  handed_over_at: number
}

const toItem = (row: ItemRow): HandedOverItem => ({
  id: row.id,
  sourceForm: row.source_form,
  content: row.content,
  receivedAt: row.received_at,
  handedOverAt: row.handed_over_at,
})

/** The store as a D1 database bound to this Worker. Bound parameters only. */
export function d1Store(db: D1Database): SafeguardingStore {
  return {
    async insert(item) {
      await db
        .prepare(
          `INSERT INTO handed_over_items (id, source_form, content, received_at, handed_over_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (id) DO NOTHING`,
        )
        .bind(item.id, item.sourceForm, item.content, item.receivedAt, item.handedOverAt)
        .run()
    },
    async readBack(id) {
      const row = await db
        .prepare('SELECT source_form, content FROM handed_over_items WHERE id = ?')
        .bind(id)
        .first<Pick<ItemRow, 'source_form' | 'content'>>()
      return row === null ? null : { sourceForm: row.source_form, content: row.content }
    },
    async list() {
      const { results } = await db
        .prepare(
          `SELECT id, source_form, received_at, handed_over_at FROM handed_over_items
           ORDER BY handed_over_at DESC, id`,
        )
        .all<Omit<ItemRow, 'content'>>()
      return results.map((row) => ({
        id: row.id,
        sourceForm: row.source_form,
        receivedAt: row.received_at,
        handedOverAt: row.handed_over_at,
      }))
    },
    async get(id) {
      const row = await db
        .prepare(
          `SELECT id, source_form, content, received_at, handed_over_at FROM handed_over_items
           WHERE id = ?`,
        )
        .bind(id)
        .first<ItemRow>()
      return row === null ? null : toItem(row)
    },
  }
}

/**
 * The store for this environment, or `null` if it is not set up. The only
 * place in the code that names the binding.
 */
export function storeFromEnv(env: object | undefined): SafeguardingStore | null {
  const db = (env as { SAFEGUARDING_DB?: D1Database } | undefined)?.SAFEGUARDING_DB
  return db ? d1Store(db) : null
}
