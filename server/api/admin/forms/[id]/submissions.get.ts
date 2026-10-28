import { defineEventHandler, getRouterParam, setResponseHeader, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../../utils/admin/guard'
import { listFormSubmissions, recordFormView } from '../../../../utils/db/admin'
import { useDb } from '../../../../utils/db/env'

/**
 * One form's submissions, newest first, each labelled by the version it was
 * sent on (#160). Behind Access. The view is recorded before anything is
 * read, so a list is never served unless its audit entry was written (#51).
 */
export default defineEventHandler(async (event) => {
  const { sub } = adminIdentity(event)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  const db = useDb(event)
  const formId = getRouterParam(event, 'id') ?? ''
  if (!(await recordFormView(db, formId, sub))) {
    setResponseStatus(event, 404)
    return { ok: false, error: 'not_found' }
  }
  return { ok: true, submissions: await listFormSubmissions(db, formId) }
})
