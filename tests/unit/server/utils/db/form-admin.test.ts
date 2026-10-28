import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import {
  checkDraft,
  createForm,
  getForm,
  listForms,
  publishDraft,
  saveDraft,
  setFormStatus,
} from '../../../../../server/utils/db/form-admin'
import { auditLogDeleteAfter } from '../../../../../server/utils/retention'

// The form builder's reads and writes (ADR-0010 phase B, #160). Made-up test data only.
const NOW = 1_793_300_000
const ACTOR = '00000000-0000-4000-8000-00000000f00d'

async function formId(slug: string): Promise<string> {
  const row = await env.DB.prepare('SELECT id FROM forms WHERE slug = ?').bind(slug).first<{
    id: string
  }>()
  return row!.id
}

async function auditFor(formId: string) {
  const { results } = await env.DB.prepare(
    `SELECT at, actor, action, target_table, target_id, delete_after FROM audit_log
     WHERE target_id = ? ORDER BY at, action`,
  )
    .bind(formId)
    .all()
  return results
}

/**
 * A form of its own for each test, since the test database is shared within
 * this file and versions can never be deleted. Each is open on version 1:
 * a copy of say hello, or, for an application, of the trustee form's steps
 * with made-up wording in place of its copy, so a wording change can publish
 * (the trustee copy names DBS checks, which always needs a second approval).
 */
async function freshForm(kind: 'form' | 'application' = 'form'): Promise<string> {
  const id = crypto.randomUUID()
  const source = await env.DB.prepare(
    `SELECT v.purpose, v.definition, v.text FROM form_versions AS v
     JOIN forms AS f ON f.id = v.form_id AND v.version = f.current_version WHERE f.slug = ?`,
  )
    .bind(kind === 'form' ? 'hello' : 'trustee')
    .first<{ purpose: string; definition: string; text: string }>()
  let text = source!.text
  if (kind === 'application') {
    const words = JSON.parse(text)['en-GB'] as Record<string, string>
    for (const key of Object.keys(words)) words[key] = `Sample wording for ${key}`
    text = JSON.stringify({ 'en-GB': words })
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO forms (id, slug, kind, status, created_at) VALUES (?, ?, ?, 'draft', 1)`,
    ).bind(id, `sample-${id.slice(0, 8)}`, kind),
    env.DB.prepare(
      `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
       VALUES (?, 1, ?, ?, ?, 1, 'migration')`,
    ).bind(id, source!.purpose, source!.definition, text),
    env.DB.prepare(`UPDATE forms SET status = 'open', current_version = 1 WHERE id = ?`).bind(id),
  ])
  return id
}

/** A form's current version, as a draft to edit. */
async function draftOf(id: string) {
  const current = (await getForm(env.DB, id))!.current!
  return {
    purpose: current.purpose,
    definition: structuredClone(current.definition) as Record<string, unknown>,
    text: structuredClone(current.text) as { 'en-GB': Record<string, string> },
  }
}

describe('the list of forms', () => {
  it('shows each form with its purpose, retention and readers, but no submissions', async () => {
    const id = await freshForm()
    const forms = await listForms(env.DB)
    expect(forms.find((form) => form.id === id)).toMatchObject({
      kind: 'form',
      status: 'open',
      version: 1,
      p3Row: 'Say hello messages',
      retentionMonths: 12,
      readers: ['central_team', 'secretary'],
      title: 'Say hello',
      hasDraft: false,
    })
    expect(forms.find((form) => form.slug === 'trustee')).toMatchObject({
      kind: 'application',
      version: 2,
    })
    // A role listed but not open yet: a draft with no version.
    expect(forms.find((form) => form.slug === 'treasurer')).toMatchObject({
      status: 'draft',
      version: null,
      p3Row: null,
      readers: [],
      title: null,
    })
  })
})

describe('creating a form', () => {
  it('makes a draft with no version, and audits it', async () => {
    const created = await createForm(env.DB, { slug: 'sample-form', kind: 'form' }, ACTOR, NOW)
    expect(created.ok).toBe(true)
    const id = (created as { id: string }).id
    expect((await getForm(env.DB, id))!.form).toMatchObject({
      slug: 'sample-form',
      status: 'draft',
      version: null,
    })
    expect(await auditFor(id)).toEqual([
      {
        at: NOW,
        actor: ACTOR,
        action: 'create_form',
        target_table: 'forms',
        target_id: id,
        delete_after: auditLogDeleteAfter(NOW),
      },
    ])
  })

  it.each([
    [{ slug: 'Sample', kind: 'form' }, 'slug_invalid'],
    [{ slug: '-sample', kind: 'form' }, 'slug_invalid'],
    [{ slug: 'x'.repeat(33), kind: 'form' }, 'slug_invalid'],
    [{ slug: 7, kind: 'form' }, 'slug_invalid'],
    [{ slug: 'admin', kind: 'form' }, 'slug_reserved'],
    [{ slug: 'hello', kind: 'form' }, 'slug_taken'],
    [{ slug: 'sample-form', kind: 'survey' }, 'kind_invalid'],
  ])('refuses %j (%s) and writes nothing', async (input, error) => {
    const before = (await env.DB.prepare('SELECT count(*) AS n FROM audit_log').first<{
      n: number
    }>())!.n
    expect(await createForm(env.DB, input, ACTOR, NOW)).toEqual({ ok: false, error })
    const after = (await env.DB.prepare('SELECT count(*) AS n FROM audit_log').first<{
      n: number
    }>())!.n
    expect(after).toBe(before)
  })
})

describe('saving a draft', () => {
  it('stores it as it is and says what publishing would find', async () => {
    const id = await freshForm('application')
    const draft = await draftOf(id)
    draft.text['en-GB'].title = 'Say hello to a sample group'
    const saved = await saveDraft(env.DB, id, draft, ACTOR, NOW)
    expect(saved).toEqual({
      ok: true,
      check: { ok: true, problems: [], needsSecondApproval: false },
    })
    const detail = await getForm(env.DB, id)
    expect(detail!.form.hasDraft).toBe(true)
    expect(detail!.draft).toEqual({ ...draft, updatedAt: NOW })
    // The published version is untouched until the draft is published.
    expect((detail!.current!.text as { 'en-GB': { title: string } })['en-GB'].title).toBe(
      'Sample wording for title',
    )
  })

  it('keeps a draft that fails the checks, with the problems', async () => {
    const id = await freshForm('application')
    const draft = await draftOf(id)
    delete draft.text['en-GB']['fields.why_trustee.label']
    const saved = await saveDraft(env.DB, id, draft, ACTOR, NOW)
    expect(saved.ok && saved.check.problems).toContainEqual({
      code: 'text_missing',
      path: 'text.en-GB.fields.why_trustee.label',
    })
    expect((await getForm(env.DB, id))!.draft).not.toBeNull()
  })

  it('replaces the earlier draft', async () => {
    const id = await freshForm('application')
    const first = await draftOf(id)
    first.text['en-GB'].title = 'A made-up first title'
    await saveDraft(env.DB, id, first, ACTOR, NOW)
    const second = await draftOf(id)
    second.text['en-GB'].title = 'A made-up second title'
    await saveDraft(env.DB, id, second, ACTOR, NOW + 1)
    const draft = (await getForm(env.DB, id))!.draft!
    expect((draft.text as { 'en-GB': { title: string } })['en-GB'].title).toBe(
      'A made-up second title',
    )
    expect(draft.updatedAt).toBe(NOW + 1)
  })

  it.each([
    ['no purpose', { definition: {}, text: {} }],
    ['a purpose that is not plain', { purpose: 'Say Hello', definition: {}, text: {} }],
    ['a definition that is not an object', { purpose: 'say_hello', definition: [], text: {} }],
    ['text that is not an object', { purpose: 'say_hello', definition: {}, text: 'hello' }],
    ['an extra key', { purpose: 'say_hello', definition: {}, text: {}, extra: 1 }],
    [
      'a definition over its stored limit',
      { purpose: 'say_hello', definition: { padding: 'x'.repeat(33 * 1024) }, text: {} },
    ],
  ])('refuses %s', async (_, content) => {
    const id = await freshForm()
    expect(await saveDraft(env.DB, id, content, ACTOR, NOW)).toEqual({
      ok: false,
      error: 'draft_invalid',
    })
    expect((await getForm(env.DB, id))!.draft).toBeNull()
  })

  it('refuses a form that does not exist', async () => {
    expect(
      await saveDraft(
        env.DB,
        '00000000-0000-4000-8000-000000000000',
        { purpose: 'say_hello', definition: {}, text: {} },
        ACTOR,
        NOW,
      ),
    ).toEqual({ ok: false, error: 'not_found' })
  })
})

describe('publishing a draft', () => {
  it('adds the next version, makes it current, drops the draft and audits it', async () => {
    const id = await freshForm('application')
    const draft = await draftOf(id)
    draft.text['en-GB'].title = 'Say hello to a sample group'
    await saveDraft(env.DB, id, draft, ACTOR, NOW)
    expect(await publishDraft(env.DB, id, ACTOR, NOW + 5)).toEqual({ ok: true, version: 2 })

    const detail = (await getForm(env.DB, id))!
    expect(detail.form).toMatchObject({ version: 2, title: 'Say hello to a sample group' })
    expect(detail.draft).toBeNull()
    expect(detail.versions.map((v) => v.version)).toEqual([2, 1])
    expect(detail.current).toMatchObject({ version: 2, publishedAt: NOW + 5 })
    const published = await env.DB.prepare(
      'SELECT published_by FROM form_versions WHERE form_id = ? AND version = 2',
    )
      .bind(id)
      .first<{ published_by: string }>()
    expect(published!.published_by).toBe(ACTOR)
    expect(await auditFor(id)).toContainEqual({
      at: NOW + 5,
      actor: ACTOR,
      action: 'publish_form_version',
      target_table: 'forms',
      target_id: id,
      delete_after: auditLogDeleteAfter(NOW + 5),
    })
  })

  it('refuses a draft that needs a second approval, and changes nothing', async () => {
    const id = await freshForm('application')
    const draft = await draftOf(id)
    draft.text['en-GB']['fields.why_trustee.label'] = 'Your made-up message to us'
    await saveDraft(env.DB, id, draft, ACTOR, NOW)
    const result = await publishDraft(env.DB, id, ACTOR, NOW)
    expect(result).toEqual({
      ok: false,
      error: 'checks_failed',
      check: {
        ok: false,
        problems: [{ code: 'second_approval_needed', path: 'definition' }],
        needsSecondApproval: true,
      },
    })
    const detail = (await getForm(env.DB, id))!
    expect(detail.form.version).toBe(1)
    expect(detail.draft).not.toBeNull()
    expect((await auditFor(id)).map((entry) => entry.action)).not.toContain('publish_form_version')
  })

  it('refuses a first version, which always needs a second approval', async () => {
    const created = await createForm(env.DB, { slug: 'sample-two', kind: 'form' }, ACTOR, NOW)
    const id = (created as { id: string }).id
    await saveDraft(env.DB, id, await draftOf(await freshForm()), ACTOR, NOW)
    const result = await publishDraft(env.DB, id, ACTOR, NOW)
    expect(result.ok).toBe(false)
    expect((result as { check: { needsSecondApproval: boolean } }).check.needsSecondApproval).toBe(
      true,
    )
    expect((await getForm(env.DB, id))!.form.version).toBeNull()
  })

  it('reports a version that someone else published first', async () => {
    const id = await freshForm('application')
    const draft = await draftOf(id)
    draft.text['en-GB'].title = 'Say hello to a sample group'
    await saveDraft(env.DB, id, draft, ACTOR, NOW)
    // Another publish's version 2 lands between the check and the batch.
    await env.DB.prepare(
      `INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
       SELECT form_id, 2, purpose, definition, text, ?, 'test-other' FROM form_versions
       WHERE form_id = ? AND version = 1`,
    )
      .bind(NOW, id)
      .run()
    expect(await publishDraft(env.DB, id, ACTOR, NOW)).toEqual({ ok: false, error: 'changed' })
    expect((await auditFor(id)).map((entry) => entry.action)).not.toContain('publish_form_version')
  })

  it('says when there is no draft, or no form', async () => {
    const id = await freshForm()
    expect(await publishDraft(env.DB, id, ACTOR, NOW)).toEqual({ ok: false, error: 'no_draft' })
    expect(await checkDraft(env.DB, id)).toBeNull()
    expect(await publishDraft(env.DB, '00000000-0000-4000-8000-000000000000', ACTOR, NOW)).toEqual({
      ok: false,
      error: 'not_found',
    })
  })
})

describe('opening and closing a form', () => {
  it('closes and opens a form with a version, auditing each change', async () => {
    const id = await freshForm()
    expect(await setFormStatus(env.DB, id, 'closed', ACTOR, NOW)).toEqual({ ok: true })
    expect((await getForm(env.DB, id))!.form.status).toBe('closed')
    expect(await setFormStatus(env.DB, id, 'open', ACTOR, NOW + 1)).toEqual({ ok: true })
    expect((await getForm(env.DB, id))!.form.status).toBe('open')
    // No change, no entry.
    expect(await setFormStatus(env.DB, id, 'open', ACTOR, NOW + 2)).toEqual({ ok: true })
    expect((await auditFor(id)).map((entry) => entry.action)).toEqual(['close_form', 'open_form'])
  })

  it('never opens a form with no version', async () => {
    const id = await formId('treasurer')
    expect(await setFormStatus(env.DB, id, 'open', ACTOR, NOW)).toEqual({
      ok: false,
      error: 'no_version',
    })
    expect((await getForm(env.DB, id))!.form.status).toBe('draft')
  })

  it.each(['draft', 'published', null])('refuses the status %j', async (status) => {
    expect(await setFormStatus(env.DB, await freshForm(), status, ACTOR, NOW)).toEqual({
      ok: false,
      error: 'status_invalid',
    })
  })
})
