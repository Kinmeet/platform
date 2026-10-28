import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { handOverFromEvent } from '../../../../safeguarding/handover'
import { adminIdentity } from '../../../../utils/admin/guard'

/**
 * "Pass to safeguarding" on an application (#36). Behind Access. Writes only:
 * the reply never carries anything from the row or the safeguarding store.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const id = getRouterParam(event, 'id') ?? ''
  const result = await handOverFromEvent(event, 'apply', id, adminIdentity(event).sub)
  if (result === 'not_found') {
    // No such application, or it was already passed.
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  if (result === 'unavailable') {
    // Nothing moved; the row is still in the list and can be tried again.
    setResponseStatus(event, 503)
    return { ok: false, error: 'unavailable' }
  }
  return { ok: true }
})
