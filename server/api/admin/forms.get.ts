import { defineEventHandler, setResponseHeader } from 'h3'
import { adminIdentity } from '../../utils/admin/guard'
import { listForms } from '../../utils/db/form-admin'
import { useDb } from '../../utils/db/env'

/** Every form, with its settings and no submissions (#160). Behind Access. */
export default defineEventHandler(async (event) => {
  adminIdentity(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return { forms: await listForms(useDb(event)) }
})
