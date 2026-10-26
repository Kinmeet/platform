import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import { auditLogDeleteAfter, nowSeconds } from '../utils/retention'
import { storeFromEnv, type HandoverStore, type SourceForm } from './store'

/**
 * "Pass to safeguarding" (#36, SG6, SG-03 section 4).
 *
 * Moves a say hello message or an application out of the main database and
 * into the interim safeguarding store (./store.ts), in one audited step. It
 * is given only the store's insert and read-back, and the read-back checks
 * the copy and returns nothing, so the admin role can never read from the
 * store.
 *
 * D1 has no transaction across two databases, so the order matters:
 * 1. copy the row into the store (doing nothing if the copy already exists),
 * 2. read the copy back and check it matches,
 * 3. delete the row from the main database and write the audit entry, in
 *    one batch.
 * A failure part-way leaves the row in the main database, visible and
 * retryable, and never in neither. A retry finds the copy from step 1 and
 * carries on.
 */

export type HandoverSource = SourceForm

export type HandoverResult = 'handed_over' | 'not_found' | 'unavailable'

interface HandoverEnv {
  DB?: D1Database
}

/**
 * Whole statements for each form, so no SQL is ever built from a value. The
 * audit entry holds the date, who acted, the action and the row id, never
 * anything from the row.
 */
const STATEMENTS = {
  hello: {
    read: `SELECT call_name, email, message, received_at FROM hello_messages WHERE id = ?`,
    remove: `DELETE FROM hello_messages WHERE id = ?`,
    audit: `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
            SELECT ?, ?, ?, 'pass_to_safeguarding', 'hello_messages', ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM hello_messages WHERE id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM audit_log
                WHERE action = 'pass_to_safeguarding' AND target_table = 'hello_messages'
                  AND target_id = ?
              )`,
  },
  apply: {
    read: `SELECT role, call_name, email, answers, received_at FROM applications WHERE id = ?`,
    remove: `DELETE FROM applications WHERE id = ?`,
    audit: `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
            SELECT ?, ?, ?, 'pass_to_safeguarding', 'applications', ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM applications WHERE id = ?)
              AND NOT EXISTS (
                SELECT 1 FROM audit_log
                WHERE action = 'pass_to_safeguarding' AND target_table = 'applications'
                  AND target_id = ?
              )`,
  },
} as const

/** The submission as it was sent, in a fixed key order so a retry builds the same text. */
async function readSubmission(main: D1Database, source: HandoverSource, id: string) {
  if (source === 'hello') {
    const row = await main
      .prepare(STATEMENTS.hello.read)
      .bind(id)
      .first<{ call_name: string; email: string; message: string; received_at: number }>()
    if (row === null) return null
    return {
      content: JSON.stringify({ callName: row.call_name, email: row.email, message: row.message }),
      receivedAt: row.received_at,
    }
  }
  const row = await main.prepare(STATEMENTS.apply.read).bind(id).first<{
    role: string
    call_name: string
    email: string
    answers: string
    received_at: number
  }>()
  if (row === null) return null
  return {
    content: JSON.stringify({
      role: row.role,
      callName: row.call_name,
      email: row.email,
      answers: JSON.parse(row.answers) as Record<string, string>,
    }),
    receivedAt: row.received_at,
  }
}

/**
 * Hands one row over. Returns `not_found` if there is no such row (or it was
 * already handed over). Throws if the copy cannot be made or checked, with
 * the row left where it was.
 */
export async function handOver(
  main: D1Database,
  store: HandoverStore,
  source: HandoverSource,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<'handed_over' | 'not_found'> {
  const submission = await readSubmission(main, source, id)
  if (submission === null) return 'not_found'

  await store.insert({
    id,
    sourceForm: source,
    content: submission.content,
    receivedAt: submission.receivedAt,
    handedOverAt: now,
  })
  const copy = await store.readBack(id)
  if (copy === null || copy.sourceForm !== source || copy.content !== submission.content) {
    throw new Error('handover_copy_mismatch')
  }

  const statements = STATEMENTS[source]
  const [removed] = await main.batch([
    main.prepare(statements.remove).bind(id),
    // Written only once the row has gone, and only once per row.
    main
      .prepare(statements.audit)
      .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id, id),
  ])
  return (removed?.meta.changes ?? 0) === 1 ? 'handed_over' : 'not_found'
}

/**
 * The hand-over for an admin route. Fails closed: with either database
 * missing, or any step failing, nothing moves and the reply is
 * `unavailable`. Logs a code only, never anything from the row.
 */
export async function handOverFromEvent(
  event: H3Event,
  source: HandoverSource,
  id: string,
  actor: string,
): Promise<HandoverResult> {
  const env = (event.context as { cloudflare?: { env?: HandoverEnv } }).cloudflare?.env
  const store = storeFromEnv(env)
  if (!env?.DB || !store) {
    console.error(JSON.stringify({ code: 'safeguarding_db_missing' }))
    return 'unavailable'
  }
  try {
    return await handOver(env.DB, store, source, id, actor)
  } catch {
    console.error(JSON.stringify({ code: 'safeguarding_handover_failed' }))
    return 'unavailable'
  }
}
