import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../utils/admin/guard'
import { getForm } from '../../../utils/db/form-admin'
import { useDb } from '../../../utils/db/env'

/** One form: its current version, its draft and its version history (#160). Behind Access. */
export default defineEventHandler(async (event) => {
  adminIdentity(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const detail = await getForm(useDb(event), getRouterParam(event, 'id') ?? '')
  if (detail === null) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  return { ok: true, ...detail }
})
