import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { adminIdentity } from '../../../../utils/admin/guard'
import { publishDraft } from '../../../../utils/db/form-admin'
import { useDb } from '../../../../utils/db/env'

/**
 * Publishes the draft as the form's next version, if every check passes
 * (#160). Behind Access. A version that needs a second approval can't
 * publish in Phase 1 (ADR-0010).
 */
export default defineEventHandler(async (event) => {
  const { sub } = adminIdentity(event)
  const result = await publishDraft(useDb(event), getRouterParam(event, 'id') ?? '', sub)
  if (!result.ok) {
    setResponseStatus(
      event,
      result.error === 'checks_failed' ? 422 : result.error === 'changed' ? 409 : 404,
    )
  }
  return result
})
