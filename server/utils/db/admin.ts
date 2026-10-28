import type { D1Database } from '@cloudflare/workers-types'
import type { AdminApplication, AdminHelloMessage } from '../../../shared/admin'
import type { FormKind } from '../../../shared/forms/runtime'
import { auditLogDeleteAfter, deleteAfterEvent, nowSeconds, retentionRule } from '../retention'
import { toVersion, type StoredVersion } from './forms'

/**
 * Reads and the two actions for the founder's admin page (#32), on
 * `form_submissions` (ADR-0010, #156).
 *
 * The page is read-only apart from "mark replied" and "mark outcome told".
 * Each action records its date, moves `delete_after` on as the version's P3
 * purpose says, and writes an audit log entry in the same transaction. Until
 * phase C drops them, the same change is made to a row's copy in
 * `hello_messages` or `applications`, so the old copy is never kept longer.
 */

/** Answers that mean the applicant may know a founder, so a conflict is declared. */
const CONFLICT_ANSWERS = new Set(['friend_or_acquaintance', 'not_sure'])

interface SubmissionRow {
  id: string
  form_id: string
  slug: string
  kind: FormKind
  version: number
  purpose: string
  definition: string
  text: string
  call_name: string
  email: string
  answers: string
  received_at: number
  replied_at: number | null
  outcome_told_at: number | null
  delete_after: number
}

const SELECT_SUBMISSIONS = `SELECT s.id, s.form_id, f.slug, f.kind, s.version, v.purpose, v.definition, v.text,
         s.call_name, s.email, s.answers, s.received_at, s.replied_at, s.outcome_told_at,
         s.delete_after
  FROM form_submissions AS s
  JOIN forms AS f ON f.id = s.form_id
  JOIN form_versions AS v ON v.form_id = s.form_id AND v.version = s.version`

function versionOf(row: SubmissionRow): StoredVersion {
  const version = toVersion({ ...row, id: row.form_id })
  if (version === null) throw new Error('form_version_invalid')
  return version
}

export async function listHelloMessages(db: D1Database): Promise<AdminHelloMessage[]> {
  const { results } = await db
    .prepare(`${SELECT_SUBMISSIONS} WHERE f.slug = 'hello' ORDER BY s.received_at DESC, s.id`)
    .all<SubmissionRow>()
  return results.map((row) => ({
    id: row.id,
    callName: row.call_name,
    email: row.email,
    message: String((JSON.parse(row.answers) as Record<string, string>).message ?? ''),
    receivedAt: row.received_at,
    repliedAt: row.replied_at,
    deleteAfter: row.delete_after,
  }))
}

/**
 * Step 3 answers only: the fields of the version's `answers` step. The
 * founder-connection answer is shown on its own, as before.
 */
export function roleAnswers(
  version: StoredVersion,
  answers: Record<string, string>,
): Record<string, string> {
  const ids = new Set(
    version.definition.steps
      .filter((step) => step.body === 'answers')
      .flatMap((step) => step.fields.map((field) => field.id)),
  )
  return Object.fromEntries(Object.entries(answers).filter(([id]) => ids.has(id)))
}

export async function listApplications(db: D1Database): Promise<AdminApplication[]> {
  const { results } = await db
    .prepare(`${SELECT_SUBMISSIONS} WHERE f.kind = 'application' ORDER BY s.received_at DESC, s.id`)
    .all<SubmissionRow>()
  return results.map((row) => {
    const answers = JSON.parse(row.answers) as Record<string, string>
    const connection = answers.connection_to_founders ?? ''
    const version = versionOf(row)
    const shown = roleAnswers(version, answers)
    return {
      id: row.id,
      role: row.slug,
      callName: row.call_name,
      email: row.email,
      answers: shown,
      labels: Object.fromEntries(
        Object.keys(shown).map((id) => [id, version.text[`fields.${id}.label`] ?? id]),
      ),
      conflictToDeclare: CONFLICT_ANSWERS.has(connection),
      connectionToFounders: connection,
      receivedAt: row.received_at,
      outcomeToldAt: row.outcome_told_at,
      deleteAfter: row.delete_after,
    }
  })
}

export type AdminList = 'hello_messages' | 'applications'

/**
 * Records that someone opened one of the admin lists. There is one entry
 * for each form whose submissions the list shows, naming the form but no
 * rows: the lists hold full content, so each fetch is audited (Nadia, Ezra,
 * #51), without the log becoming an index of the data.
 */
export async function recordListView(
  db: D1Database,
  list: AdminList,
  actor: string,
  now = nowSeconds(),
): Promise<void> {
  const { results: forms } = await db
    .prepare(
      list === 'hello_messages'
        ? `SELECT id FROM forms WHERE slug = 'hello'`
        : `SELECT id FROM forms WHERE kind = 'application' AND current_version IS NOT NULL`,
    )
    .all<{ id: string }>()
  if (forms.length === 0) throw new Error('admin_list_forms_missing')
  await db.batch(
    forms.map((form) =>
      db
        .prepare(
          `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
           VALUES (?, ?, ?, 'view_form_submissions', 'forms', ?, ?)`,
        )
        .bind(crypto.randomUUID(), now, actor, form.id, auditLogDeleteAfter(now)),
    ),
  )
}

/** One submission on the list it belongs to, or `null`. */
async function findSubmission(
  db: D1Database,
  list: AdminList,
  id: string,
): Promise<SubmissionRow | null> {
  return db
    .prepare(
      list === 'hello_messages'
        ? `${SELECT_SUBMISSIONS} WHERE s.id = ? AND f.slug = 'hello'`
        : `${SELECT_SUBMISSIONS} WHERE s.id = ? AND f.kind = 'application'`,
    )
    .bind(id)
    .first<SubmissionRow>()
}

/**
 * Records a reply to a say hello message: `replied_at` is now and the
 * message is kept until 12 months after this reply (its purpose's period).
 * Each reply moves the date on again. Returns `false` if there is no such
 * message.
 */
export async function markReplied(
  db: D1Database,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<boolean> {
  const row = await findSubmission(db, 'hello_messages', id)
  if (row === null) return false
  const version = versionOf(row)
  if (!version.definition.actions.includes('reply') || version.purpose.retention.base !== 'replied')
    return false
  const deleteAfter = deleteAfterEvent(
    retentionRule(version.purpose, version.definition.retentionMonths),
    now,
  )

  const [update] = await db.batch([
    db
      .prepare('UPDATE form_submissions SET replied_at = ?, delete_after = ? WHERE id = ?')
      .bind(now, deleteAfter, id),
    db
      .prepare('UPDATE hello_messages SET replied_at = ?, delete_after = ? WHERE id = ?')
      .bind(now, deleteAfter, id),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
         SELECT ?, ?, ?, 'mark_replied', 'form_submissions', ?, ?
         WHERE EXISTS (SELECT 1 FROM form_submissions WHERE id = ?)`,
      )
      .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id),
  ])
  return (update?.meta.changes ?? 0) === 1
}

/**
 * Records that an applicant has been told the outcome: kept until 6 months
 * after that date (its purpose's period), replacing the round-close
 * backstop. Only the first time counts, so marking again changes nothing and
 * writes no audit entry. Returns `false` if there is no such application or
 * it was already marked.
 */
export async function markOutcomeTold(
  db: D1Database,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<boolean> {
  const row = await findSubmission(db, 'applications', id)
  if (row === null || row.outcome_told_at !== null) return false
  const version = versionOf(row)
  if (
    !version.definition.actions.includes('outcome_told') ||
    version.purpose.retention.base !== 'outcome_told'
  )
    return false
  const deleteAfter = deleteAfterEvent(
    retentionRule(version.purpose, version.definition.retentionMonths),
    now,
  )

  const [update] = await db.batch([
    db
      .prepare(
        `UPDATE form_submissions SET outcome_told_at = ?, delete_after = ?
         WHERE id = ? AND outcome_told_at IS NULL`,
      )
      .bind(now, deleteAfter, id),
    db
      .prepare(
        `UPDATE applications SET outcome_told_at = ?, delete_after = ?
         WHERE id = ? AND outcome_told_at IS NULL`,
      )
      .bind(now, deleteAfter, id),
    // Written only if this batch's update took effect: the row now carries
    // exactly this time, and no entry for it exists yet.
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
         SELECT ?, ?, ?, 'mark_outcome_told', 'form_submissions', ?, ?
         WHERE EXISTS (SELECT 1 FROM form_submissions WHERE id = ? AND outcome_told_at = ?)
           AND NOT EXISTS (
             SELECT 1 FROM audit_log
             WHERE action = 'mark_outcome_told' AND target_id = ?
           )`,
      )
      .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id, now, id),
  ])
  return (update?.meta.changes ?? 0) === 1
}
