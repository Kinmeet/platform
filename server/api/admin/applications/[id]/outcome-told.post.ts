import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../../utils/admin/guard'
import { markOutcomeTold } from '../../../../utils/db/admin'
import { useDb } from '../../../../utils/db/env'

/** "Mark outcome told" on an application (#32). Behind Access. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const done = await markOutcomeTold(useDb(event), id, adminIdentity(event).sub)
  if (!done) {
    // No such application, or the outcome was already recorded.
    setResponseStatus(event, 409)
    return { ok: false, error: 'not_changed' }
  }
  return { ok: true }
})
