import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { adminIdentity, publishRechecked, reauthRequired } from '../../../../utils/admin/guard'
import { publishDraft } from '../../../../utils/db/form-admin'
import { useDb } from '../../../../utils/db/env'

/**
 * Publishes the draft as the form's next version, if every check passes
 * (#160). Behind the publish Access application, with MFA on every sign-in:
 * the admin middleware checks its fresh token, and this route refuses
 * unless that check ran (ADR-0010). A version that needs a second approval
 * can't publish in Phase 1.
 */
export default defineEventHandler(async (event) => {
  if (!publishRechecked(event)) return reauthRequired(event)
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
