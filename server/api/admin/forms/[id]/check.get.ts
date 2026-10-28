import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { toPublicForm, type PublicForm } from '../../../../../shared/forms/view'
import { definitionSchema } from '../../../../../shared/forms/definition'
import { findPurpose } from '../../../../../shared/privacy/purposes'
import { adminIdentity } from '../../../../utils/admin/guard'
import { checkDraft } from '../../../../utils/db/form-admin'
import { useDb } from '../../../../utils/db/env'

/**
 * What publishing the draft would find, and, when its definition and text
 * are sound, the draft as its page would get it, for the preview (#160).
 * Behind Access.
 */
export default defineEventHandler(async (event) => {
  adminIdentity(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const checked = await checkDraft(useDb(event), getRouterParam(event, 'id') ?? '')
  if (checked === null) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  const { detail, check } = checked
  const draft = detail.draft!
  const definition = definitionSchema.safeParse(draft.definition)
  const purpose = findPurpose(draft.purpose)
  const shapeOk = !check.problems.some(
    (problem) => problem.path === 'text' || problem.path.startsWith('text.'),
  )
  let preview: PublicForm | null = null
  if (definition.success && purpose && shapeOk) {
    preview = toPublicForm({
      slug: detail.form.slug,
      kind: detail.form.kind,
      version: (detail.form.version ?? 0) + 1,
      definition: definition.data,
      text: (draft.text as { 'en-GB': Record<string, string> })['en-GB'],
      purpose,
    })
  }
  return { ok: true, check, preview }
})
