import { defineEventHandler, setResponseStatus } from 'h3'
import { DEFAULT_BODY_LIMIT } from '../../../shared/routes'
import { readAdminJson } from '../../utils/admin/body'
import { adminIdentity } from '../../utils/admin/guard'
import { createForm } from '../../utils/db/form-admin'
import { useDb } from '../../utils/db/env'

/** Creates a form as a draft with no version: `{ slug, kind }` (#160). Behind Access. */
export default defineEventHandler(async (event) => {
  const { sub } = adminIdentity(event)
  const body = await readAdminJson(event, DEFAULT_BODY_LIMIT)
  if (body === null) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'bad_request' }
  }
  const result = await createForm(useDb(event), { slug: body.slug, kind: body.kind }, sub)
  if (!result.ok) setResponseStatus(event, result.error === 'slug_taken' ? 409 : 422)
  else setResponseStatus(event, 201)
  return result
})
