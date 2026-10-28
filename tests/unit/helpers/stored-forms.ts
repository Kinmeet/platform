import { env } from 'cloudflare:test'
import { definitionSchema } from '../../../shared/forms/definition'
import { toPublicForm, type PublicForm } from '../../../shared/forms/view'

/**
 * A seeded form's current version, as `GET /api/forms/<slug>` serves it to
 * its page (ADR-0010, A2), read from the test database the migrations made.
 */
export async function loadPublicForm(slug: string): Promise<PublicForm> {
  const row = await env.DB.prepare(
    `SELECT f.slug, f.kind, v.version, v.definition, v.text FROM forms AS f
     JOIN form_versions AS v ON v.form_id = f.id AND v.version = f.current_version
     WHERE f.slug = ?`,
  )
    .bind(slug)
    .first<{
      slug: string
      kind: 'form' | 'application'
      version: number
      definition: string
      text: string
    }>()
  if (!row) throw new Error(`no open form ${slug}`)
  return toPublicForm({
    slug: row.slug,
    kind: row.kind,
    version: row.version,
    definition: definitionSchema.parse(JSON.parse(row.definition)),
    text: JSON.parse(row.text)['en-GB'],
  })
}
