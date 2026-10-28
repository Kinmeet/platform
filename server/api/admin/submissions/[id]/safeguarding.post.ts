import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { handOverFromEvent } from '../../../../safeguarding/handover'
import { adminIdentity } from '../../../../utils/admin/guard'
import { handoverSourceOf } from '../../../../utils/db/admin'
import { useDb } from '../../../../utils/db/env'

/**
 * "Pass to safeguarding" on any submission from a form the interim store
 * takes: say hello or an application (#36, #160). Behind Access. Writes
 * only: the reply never carries anything from the row or the store.
 */
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const { sub } = adminIdentity(event)
  const id = getRouterParam(event, 'id') ?? ''
  const source = await handoverSourceOf(useDb(event), id)
  const result = source === null ? 'not_found' : await handOverFromEvent(event, source, id, sub)
  if (result === 'not_found') {
    // No such submission, it was already passed, or its form can't be handed over yet.
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
