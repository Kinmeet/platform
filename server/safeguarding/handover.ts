import type { D1Database } from '@cloudflare/workers-types'
import type { H3Event } from 'h3'
import type { FormKind } from '../../shared/forms/runtime'
import { roleAnswers } from '../utils/db/admin'
import { toVersion } from '../utils/db/forms'
import { auditLogDeleteAfter, nowSeconds } from '../utils/retention'
import { storeFromEnv, type HandoverStore, type SourceForm } from './store'

/**
 * "Pass to safeguarding" (#36, SG6, SG-03 section 4).
 *
 * Moves a say hello message or an application out of the general lists and
 * into the encrypted interim safeguarding store (./store.ts), in one audited
 * step. It is given only the store's insert and read-back, and uses the
 * read-back only to check the copy, never to return it, so the admin role
 * can never read from the store.
 *
 * Insert, then verify, then delete (Nadia's condition 5 on #95):
 * 1. encrypt the row into the store (doing nothing if the copy already
 *    exists),
 * 2. read the copy back, decrypt it and check it matches,
 * 3. delete the row, and its copy in the old table, and write the audit
 *    entry, in one batch.
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
 * Whole statements for each list, so no SQL is ever built from a value. The
 * row is read from `form_submissions` (ADR-0010, #156), and deleted there
 * and from its copy in the old table, which stays until phase C, in the same
 * batch: a hand-over never leaves a plain copy behind. The audit entry holds
 * the date, who acted, the action and the item id, never anything from the
 * row. It names the item, not the form it came from, so the log does not say
 * in clear which form a concern was raised through (Ezra, #95).
 */
const READ = `SELECT f.slug, s.answers, s.call_name, s.email, s.received_at, v.definition,
                     f.id AS form_id, f.kind, s.version, v.purpose
              FROM form_submissions AS s
              JOIN forms AS f ON f.id = s.form_id
              JOIN form_versions AS v ON v.form_id = s.form_id AND v.version = s.version`

const AUDIT = `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
               SELECT ?, ?, ?, 'pass_to_safeguarding', 'safeguarding_items', ?, ?
               WHERE NOT EXISTS (SELECT 1 FROM form_submissions WHERE id = ?)
                 AND NOT EXISTS (
                   SELECT 1 FROM audit_log
                   WHERE action = 'pass_to_safeguarding' AND target_id = ?
                 )`

const STATEMENTS = {
  hello: {
    read: `${READ} WHERE s.id = ? AND f.slug = 'hello'`,
    removeLegacy: `DELETE FROM hello_messages WHERE id = ?`,
  },
  apply: {
    read: `${READ} WHERE s.id = ? AND f.kind = 'application'`,
    removeLegacy: `DELETE FROM applications WHERE id = ?`,
  },
} as const

interface SubmissionRow {
  slug: string
  answers: string
  call_name: string
  email: string
  received_at: number
  definition: string
  form_id: string
  kind: FormKind
  version: number
  purpose: string
}

/**
 * The submission as it was sent, in a fixed key order so a retry builds the
 * same text. The shape is the one #91 encrypted, so every item opens the
 * same way in the acting lead's view (#93): the form's slug is inside, as
 * `role` for an application.
 */
async function readSubmission(main: D1Database, source: HandoverSource, id: string) {
  const row = await main.prepare(STATEMENTS[source].read).bind(id).first<SubmissionRow>()
  if (row === null) return null
  const answers = JSON.parse(row.answers) as Record<string, string>
  if (source === 'hello') {
    return {
      content: JSON.stringify({
        callName: row.call_name,
        email: row.email,
        message: answers.message ?? '',
      }),
      receivedAt: row.received_at,
    }
  }
  const version = toVersion({ ...row, id: row.form_id })
  if (version === null) throw new Error('form_version_invalid')
  return {
    content: JSON.stringify({
      role: row.slug,
      callName: row.call_name,
      email: row.email,
      answers: roleAnswers(version, answers),
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
  if (
    copy === null ||
    copy.sourceForm !== source ||
    copy.content !== submission.content ||
    copy.receivedAt !== submission.receivedAt
  ) {
    throw new Error('handover_copy_mismatch')
  }

  const [removed] = await main.batch([
    main.prepare('DELETE FROM form_submissions WHERE id = ?').bind(id),
    main.prepare(STATEMENTS[source].removeLegacy).bind(id),
    // Written only once the row has gone, and only once per row.
    main.prepare(AUDIT).bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id, id),
  ])
  return (removed?.meta.changes ?? 0) === 1 ? 'handed_over' : 'not_found'
}

/**
 * The hand-over for an admin route. Fails closed: with the database or the
 * key missing, or any step failing, nothing moves and the reply is
 * `unavailable`. Logs a code only, never anything from the row.
 */
export async function handOverFromEvent(
  event: H3Event,
  source: HandoverSource,
  id: string,
  actor: string,
): Promise<HandoverResult> {
  const env = (event.context as { cloudflare?: { env?: HandoverEnv } }).cloudflare?.env
  const store = await storeFromEnv(env)
  if (!env?.DB || !store) {
    console.error(JSON.stringify({ code: 'safeguarding_store_unavailable' }))
    return 'unavailable'
  }
  try {
    return await handOver(env.DB, store, source, id, actor)
  } catch {
    console.error(JSON.stringify({ code: 'safeguarding_handover_failed' }))
    return 'unavailable'
  }
}
