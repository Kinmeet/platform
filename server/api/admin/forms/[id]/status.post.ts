import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { DEFAULT_BODY_LIMIT } from '../../../../../shared/routes'
import { readAdminJson } from '../../../../utils/admin/body'
import { adminIdentity } from '../../../../utils/admin/guard'
import { setFormStatus } from '../../../../utils/db/form-admin'
import { useDb } from '../../../../utils/db/env'

/** Opens or closes a form: `{ status: "open" | "closed" }` (#160). Behind Access. */
export default defineEventHandler(async (event) => {
  const { sub } = adminIdentity(event)
  const body = await readAdminJson(event, DEFAULT_BODY_LIMIT)
  if (body === null) {
    setResponseStatus(event, 400)
    return { ok: false, error: 'bad_request' }
  }
  const result = await setFormStatus(
    useDb(event),
    getRouterParam(event, 'id') ?? '',
    body.status,
    sub,
  )
  if (!result.ok) setResponseStatus(event, result.error === 'not_found' ? 404 : 422)
  return result
})
