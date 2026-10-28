import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { FORM_DRAFT_BODY_LIMIT } from '../../../../../shared/routes'
import { readAdminJson } from '../../../../utils/admin/body'
import { adminIdentity } from '../../../../utils/admin/guard'
import { saveDraft } from '../../../../utils/db/form-admin'
import { useDb } from '../../../../utils/db/env'

/**
 * Saves a form's draft: `{ purpose, definition, text }` (#160). Behind
 * Access. Replies with what publishing would find, as codes and paths.
 */
export default defineEventHandler(async (event) => {
  const { sub } = adminIdentity(event)
  const body = await readAdminJson(event, FORM_DRAFT_BODY_LIMIT)
  if (body === null) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'bad_request' }
  }
  const result = await saveDraft(useDb(event), getRouterParam(event, 'id') ?? '', body, sub)
  if (!result.ok) setResponseStatus(event, result.error === 'not_found' ? 404 : 422)
  return result
})
