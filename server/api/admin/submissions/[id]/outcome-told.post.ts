import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../../utils/admin/guard'
import { markOutcomeTold } from '../../../../utils/db/admin'
import { useDb } from '../../../../utils/db/env'

/**
 * "Mark outcome told" on any submission whose version allows it (#160).
 * Behind Access. Only the first time counts.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const done = await markOutcomeTold(useDb(event), id, adminIdentity(event).sub, undefined, 'any')
  if (!done) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  return { ok: true }
})
