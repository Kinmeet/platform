import type { D1Database } from '@cloudflare/workers-types'
import type {
  AdminFormCheck,
  AdminFormContent,
  AdminFormDetail,
  AdminFormSummary,
} from '../../../shared/admin'
import { LIMITS, definitionSchema } from '../../../shared/forms/definition'
import {
  SLUG,
  checkPublish,
  reservedSlugs,
  type PublishedVersion,
} from '../../../shared/forms/publish'
import type { FormKind } from '../../../shared/forms/runtime'
import { findPurpose } from '../../../shared/privacy/purposes'
import { auditLogDeleteAfter, nowSeconds } from '../retention'
import type { FormStatus } from './forms'

/**
 * The form builder's reads and writes (ADR-0010 phase B, #160), behind
 * Access. Only fixed statements with bound values.
 *
 * A form has at most one draft: the working copy an admin edits. Saving a
 * draft stores it as it is, even if it would fail the publish checks, and
 * returns what those checks find. Publishing checks it in full against the
 * current version, adds it as the next version, makes that the current one,
 * deletes the draft and writes an audit entry, all in one batch. A version
 * is never changed afterwards (0005's triggers). Creating, opening and
 * closing a form are audited too. Nothing here reads a submission.
 */

interface FormListRow {
  id: string
  slug: string
  kind: FormKind
  status: FormStatus
  version: number | null
  purpose: string | null
  definition: string | null
  text: string | null
  has_draft: number
}

const SELECT_FORM_LIST = `SELECT f.id, f.slug, f.kind, f.status, f.current_version AS version,
         v.purpose, v.definition, v.text,
         EXISTS (SELECT 1 FROM form_drafts AS d WHERE d.form_id = f.id) AS has_draft
  FROM forms AS f
  LEFT JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version`

function parse(json: string | null): unknown {
  return json === null ? null : JSON.parse(json)
}

function toSummary(row: FormListRow): AdminFormSummary {
  const purpose = row.purpose === null ? undefined : findPurpose(row.purpose)
  const definition = definitionSchema.safeParse(parse(row.definition))
  const text = parse(row.text) as { 'en-GB'?: Record<string, string> } | null
  return {
    id: row.id,
    slug: row.slug,
    kind: row.kind,
    status: row.status,
    version: row.version,
    p3Row: purpose?.p3Row ?? null,
    retentionMonths: definition.success
      ? (definition.data.retentionMonths ?? purpose?.retention.months ?? null)
      : null,
    readers: definition.success ? [...definition.data.readers] : [],
    title: text?.['en-GB']?.title ?? null,
    hasDraft: row.has_draft === 1,
  }
}

function audit(
  db: D1Database,
  action: 'create_form' | 'publish_form_version' | 'open_form' | 'close_form',
  formId: string,
  actor: string,
  now: number,
) {
  return db
    .prepare(
      `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
       VALUES (?, ?, ?, ?, 'forms', ?, ?)`,
    )
    .bind(crypto.randomUUID(), now, actor, action, formId, auditLogDeleteAfter(now))
}

/** Every form, by slug. */
export async function listForms(db: D1Database): Promise<AdminFormSummary[]> {
  const { results } = await db.prepare(`${SELECT_FORM_LIST} ORDER BY f.slug`).all<FormListRow>()
  return results.map(toSummary)
}

/** One form with its current version, its draft and its version history, or `null`. */
export async function getForm(db: D1Database, id: string): Promise<AdminFormDetail | null> {
  const row = await db.prepare(`${SELECT_FORM_LIST} WHERE f.id = ?`).bind(id).first<FormListRow>()
  if (row === null) return null
  const [draft, versions] = await Promise.all([
    db
      .prepare('SELECT purpose, definition, text, updated_at FROM form_drafts WHERE form_id = ?')
      .bind(id)
      .first<{ purpose: string; definition: string; text: string; updated_at: number }>(),
    db
      .prepare(
        `SELECT version, published_at FROM form_versions WHERE form_id = ? ORDER BY version DESC`,
      )
      .bind(id)
      .all<{ version: number; published_at: number }>(),
  ])
  const history = versions.results.map((v) => ({ version: v.version, publishedAt: v.published_at }))
  return {
    form: toSummary(row),
    current:
      row.version === null || row.purpose === null
        ? null
        : {
            version: row.version,
            publishedAt: history.find((v) => v.version === row.version)?.publishedAt ?? 0,
            purpose: row.purpose,
            definition: parse(row.definition),
            text: parse(row.text),
          },
    draft:
      draft === null
        ? null
        : {
            purpose: draft.purpose,
            definition: JSON.parse(draft.definition),
            text: JSON.parse(draft.text),
            updatedAt: draft.updated_at,
          },
    versions: history,
  }
}

export type CreateFormResult =
  | { ok: true; id: string }
  | { ok: false; error: 'slug_invalid' | 'slug_reserved' | 'slug_taken' | 'kind_invalid' }

/**
 * A new form, as a draft with no version. Its slug is its address and its
 * spam check action, so it is checked as publishing checks it, and is unique
 * whatever the letter case.
 */
export async function createForm(
  db: D1Database,
  input: { slug: unknown; kind: unknown },
  actor: string,
  now = nowSeconds(),
): Promise<CreateFormResult> {
  if (input.kind !== 'form' && input.kind !== 'application')
    return { ok: false, error: 'kind_invalid' }
  if (typeof input.slug !== 'string' || !SLUG.test(input.slug))
    return { ok: false, error: 'slug_invalid' }
  if ((reservedSlugs as readonly string[]).includes(input.slug))
    return { ok: false, error: 'slug_reserved' }
  const id = crypto.randomUUID()
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, ?, 'draft', ?)
         ON CONFLICT (slug) DO NOTHING`,
      )
      .bind(id, input.slug, input.kind, now),
    db
      .prepare(
        `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
         SELECT ?, ?, ?, 'create_form', 'forms', ?, ? WHERE EXISTS (SELECT 1 FROM forms WHERE id = ?)`,
      )
      .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id),
  ])
  if ((inserted?.meta.changes ?? 0) !== 1) return { ok: false, error: 'slug_taken' }
  return { ok: true, id }
}

/** The current version as `checkPublish` compares against it, or `null`. */
function previousOf(detail: AdminFormDetail): PublishedVersion | null {
  if (detail.current === null) return null
  const definition = definitionSchema.safeParse(detail.current.definition)
  if (!definition.success) throw new Error('form_version_invalid')
  return {
    purpose: detail.current.purpose,
    definition: definition.data,
    text: detail.current.text,
  }
}

function check(detail: AdminFormDetail, content: AdminFormContent): AdminFormCheck {
  return checkPublish(
    {
      slug: detail.form.slug,
      kind: detail.form.kind,
      purpose: content.purpose,
      definition: content.definition,
      text: content.text,
    },
    previousOf(detail),
  )
}

export type SaveDraftResult =
  { ok: true; check: AdminFormCheck } | { ok: false; error: 'not_found' | 'draft_invalid' }

/**
 * Saves the form's draft, replacing any earlier one. The draft only has to
 * be the right shape to be saved: a purpose name and two JSON objects within
 * the stored limits. The reply says what publishing would find.
 */
export async function saveDraft(
  db: D1Database,
  id: string,
  content: Record<string, unknown>,
  actor: string,
  now = nowSeconds(),
): Promise<SaveDraftResult> {
  const { purpose, definition, text } = content
  const isObject = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
  if (
    typeof purpose !== 'string' ||
    !/^[a-z][a-z_]{0,63}$/.test(purpose) ||
    !isObject(definition) ||
    !isObject(text) ||
    Object.keys(content).some((key) => !['purpose', 'definition', 'text'].includes(key))
  )
    return { ok: false, error: 'draft_invalid' }
  const definitionJson = JSON.stringify(definition)
  const textJson = JSON.stringify(text)
  if (definitionJson.length > LIMITS.definitionJson || textJson.length > LIMITS.textJson)
    return { ok: false, error: 'draft_invalid' }

  const detail = await getForm(db, id)
  if (detail === null) return { ok: false, error: 'not_found' }
  await db
    .prepare(
      `INSERT INTO form_drafts (form_id, purpose, definition, text, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (form_id) DO UPDATE SET
         purpose = excluded.purpose, definition = excluded.definition, text = excluded.text,
         updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    )
    .bind(id, purpose, definitionJson, textJson, now, actor)
    .run()
  return { ok: true, check: check(detail, { purpose, definition, text }) }
}

/** What publishing the draft would find, or `null` if there is no draft. */
export async function checkDraft(
  db: D1Database,
  id: string,
): Promise<{ detail: AdminFormDetail; check: AdminFormCheck } | null> {
  const detail = await getForm(db, id)
  if (detail === null || detail.draft === null) return null
  return { detail, check: check(detail, detail.draft) }
}

export type PublishResult =
  | { ok: true; version: number }
  | { ok: false; error: 'not_found' | 'no_draft' | 'changed' }
  | { ok: false; error: 'checks_failed'; check: AdminFormCheck }

/**
 * Publishes the draft as the next version, if it passes every check
 * (including the second approval, which nobody can give in Phase 1). The
 * batch only takes effect if the current version is still the one that was
 * checked, so two publishes at once can't both win: the second adds nothing
 * and reports `changed`.
 */
export async function publishDraft(
  db: D1Database,
  id: string,
  actor: string,
  now = nowSeconds(),
): Promise<PublishResult> {
  const checked = await checkDraft(db, id)
  if (checked === null) {
    return { ok: false, error: (await getForm(db, id)) === null ? 'not_found' : 'no_draft' }
  }
  const { detail, check: result } = checked
  if (!result.ok) return { ok: false, error: 'checks_failed', check: result }
  const draft = detail.draft!
  const previous = detail.form.version
  const next = (previous ?? 0) + 1
  const definitionJson = JSON.stringify(draft.definition)
  const textJson = JSON.stringify(draft.text)
  try {
    const [inserted] = await db.batch([
      db
        .prepare(
          `INSERT INTO form_versions
             (form_id, version, purpose, definition, text, published_at, published_by)
           SELECT ?, ?, ?, ?, ?, ?, ?
           WHERE EXISTS (SELECT 1 FROM forms WHERE id = ? AND current_version IS ?)`,
        )
        .bind(id, next, draft.purpose, definitionJson, textJson, now, actor, id, previous),
      db
        .prepare(
          `UPDATE forms SET current_version = ? WHERE id = ? AND current_version IS ?
           AND EXISTS (SELECT 1 FROM form_versions WHERE form_id = ? AND version = ?)`,
        )
        .bind(next, id, previous, id, next),
      // Only the draft that was checked and published: one saved since then
      // is newer work and stays (Theo, #163).
      db
        .prepare(
          `DELETE FROM form_drafts
           WHERE form_id = ? AND purpose = ? AND definition = ? AND text = ?
             AND EXISTS (SELECT 1 FROM forms WHERE id = ? AND current_version = ?)`,
        )
        .bind(id, draft.purpose, definitionJson, textJson, id, next),
      db
        .prepare(
          `INSERT INTO audit_log (id, at, actor, action, target_table, target_id, delete_after)
           SELECT ?, ?, ?, 'publish_form_version', 'forms', ?, ?
           WHERE EXISTS (SELECT 1 FROM forms WHERE id = ? AND current_version = ?)`,
        )
        .bind(crypto.randomUUID(), now, actor, id, auditLogDeleteAfter(now), id, next),
    ])
    if ((inserted?.meta.changes ?? 0) !== 1) return { ok: false, error: 'changed' }
  } catch (error) {
    // Another publish added this version number first; anything else is a failure.
    if (/UNIQUE|PRIMARY KEY/i.test(String(error))) return { ok: false, error: 'changed' }
    throw error
  }
  return { ok: true, version: next }
}

export type StatusResult =
  { ok: true } | { ok: false; error: 'not_found' | 'status_invalid' | 'no_version' }

/**
 * Opens or closes a form. Only a form with a published version can open.
 * Closing stops new submissions; nothing already sent is changed.
 */
export async function setFormStatus(
  db: D1Database,
  id: string,
  status: unknown,
  actor: string,
  now = nowSeconds(),
): Promise<StatusResult> {
  if (status !== 'open' && status !== 'closed') return { ok: false, error: 'status_invalid' }
  const form = await db
    .prepare('SELECT status, current_version FROM forms WHERE id = ?')
    .bind(id)
    .first<{ status: FormStatus; current_version: number | null }>()
  if (form === null) return { ok: false, error: 'not_found' }
  if (form.current_version === null) return { ok: false, error: 'no_version' }
  if (form.status === status) return { ok: true }
  await db.batch([
    db
      .prepare('UPDATE forms SET status = ? WHERE id = ? AND current_version IS NOT NULL')
      .bind(status, id),
    audit(db, status === 'open' ? 'open_form' : 'close_form', id, actor, now),
  ])
  return { ok: true }
}
