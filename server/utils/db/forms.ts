import type { D1Database } from '@cloudflare/workers-types'
import { definitionSchema, type FormDefinition } from '../../../shared/forms/definition'
import { storedAnswers, type FormKind } from '../../../shared/forms/runtime'
import { findPurpose, type Purpose } from '../../../shared/privacy/purposes'
import type { StoreResult } from '../forms/process'
import { deleteAfterReceipt, nowSeconds, retentionRule } from '../retention'

/**
 * Stored forms (ADR-0010): `forms`, `form_versions` and `form_submissions`
 * (migrations/db/0005). Only fixed statements with bound values.
 */

export type FormStatus = 'draft' | 'open' | 'closed'

export interface StoredForm {
  id: string
  slug: string
  kind: FormKind
  status: FormStatus
  /** The current version, or `null` for a draft that was never published. */
  current: StoredVersion | null
}

export interface StoredVersion {
  version: number
  purposeId: string
  purpose: Purpose
  definition: FormDefinition
}

export interface FormRow {
  id: string
  slug: string
  kind: FormKind
  status: FormStatus
  version: number | null
  purpose: string | null
  definition: string | null
}

const SELECT_FORMS = `SELECT f.id, f.slug, f.kind, f.status, f.current_version AS version,
         v.purpose, v.definition
  FROM forms AS f
  LEFT JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version`

// Published versions never change, so each is checked once per isolate.
const versions = new Map<string, StoredVersion>()

/**
 * A stored version, checked again on the way out: a row that doesn't pass
 * the definition schema, or names a purpose we don't have, is never used.
 */
export function toVersion(
  row: Pick<FormRow, 'id' | 'kind' | 'version' | 'purpose' | 'definition'>,
): StoredVersion | null {
  if (row.version === null || row.purpose === null || row.definition === null) return null
  const key = `${row.id}:${row.version}`
  const cached = versions.get(key)
  if (cached) return cached
  const purpose = findPurpose(row.purpose)
  const definition = definitionSchema.safeParse(JSON.parse(row.definition))
  if (!purpose || purpose.kind !== row.kind || !definition.success) {
    throw new Error('form_version_invalid')
  }
  const version = {
    version: row.version,
    purposeId: row.purpose,
    purpose,
    definition: definition.data,
  }
  versions.set(key, version)
  return version
}

function toForm(row: FormRow): StoredForm {
  return { id: row.id, slug: row.slug, kind: row.kind, status: row.status, current: toVersion(row) }
}

/** The form with this slug, or `null`. Slugs are unique ignoring case. */
export async function findForm(db: D1Database, slug: string): Promise<StoredForm | null> {
  const row = await db.prepare(`${SELECT_FORMS} WHERE f.slug = ?`).bind(slug).first<FormRow>()
  return row === null ? null : toForm(row)
}

/** Every form of a kind, by slug. */
export async function formsOfKind(db: D1Database, kind: FormKind): Promise<StoredForm[]> {
  const { results } = await db
    .prepare(`${SELECT_FORMS} WHERE f.kind = ? ORDER BY f.slug`)
    .bind(kind)
    .all<FormRow>()
  return results.map(toForm)
}

export async function formSubmissionExists(db: D1Database, submissionId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS found FROM form_submissions WHERE submission_id = ?')
    .bind(submissionId)
    .first<{ found: number }>()
  return row !== null
}

/**
 * Stores a submission on the form's current version, with its deletion date
 * from the version's purpose. Only the answers the version keeps are stored
 * (`storedAnswers`). A second request with the same `submissionId` changes
 * nothing and reports `duplicate`, so concurrent retries never make two rows.
 */
export async function insertFormSubmission(
  db: D1Database,
  form: StoredForm,
  submission: { submissionId: string; callName: string; email: string } & Record<string, unknown>,
  { roundClosesAt, now = nowSeconds() }: { roundClosesAt: number; now?: number },
): Promise<StoreResult> {
  const current = form.current
  if (form.status !== 'open' || current === null) throw new Error('form_not_open')
  const rule = retentionRule(current.purpose, current.definition.retentionMonths)
  const result = await db
    .prepare(
      `INSERT INTO form_submissions
         (id, submission_id, form_id, version, call_name, email, answers,
          received_at, delete_after)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (submission_id) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      submission.submissionId,
      form.id,
      current.version,
      submission.callName,
      submission.email,
      JSON.stringify(storedAnswers(current.definition, submission)),
      now,
      deleteAfterReceipt(rule, now, roundClosesAt),
    )
    .run()
  return result.meta.changes === 1 ? 'stored' : 'duplicate'
}
