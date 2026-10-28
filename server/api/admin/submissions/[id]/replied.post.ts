import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../../utils/admin/guard'
import { markReplied } from '../../../../utils/db/admin'
import { useDb } from '../../../../utils/db/env'

/** "Mark replied" on any submission whose version allows it (#160). Behind Access. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id') ?? ''
  const done = await markReplied(useDb(event), id, adminIdentity(event).sub, undefined, 'any')
  if (!done) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  return { ok: true }
})
