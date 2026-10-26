import { defineEventHandler } from 'h3'
import { adminIdentity } from '../../utils/admin/guard'
import { listHelloMessages } from '../../utils/db/admin'
import { useDb } from '../../utils/db/env'

/** Say hello messages for the admin page, newest first. Behind Access. */
export default defineEventHandler(async (event) => {
  // Throws unless the admin middleware verified an Access token, so the list
  // is never served if the route is ever reached without it (Theo, #51).
  adminIdentity(event)
  return { messages: await listHelloMessages(useDb(event)) }
})
