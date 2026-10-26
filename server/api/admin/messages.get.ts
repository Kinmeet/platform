import { defineEventHandler } from 'h3'
import { adminIdentity } from '../../utils/admin/guard'
import { listHelloMessages, recordListView } from '../../utils/db/admin'
import { useDb } from '../../utils/db/env'

/** Say hello messages for the admin page, newest first. Behind Access. */
export default defineEventHandler(async (event) => {
  // Throws unless the admin middleware verified an Access token, so the list
  // is never served if the route is ever reached without it (Theo, #51).
  const { sub } = adminIdentity(event)
  const db = useDb(event)
  // The view is recorded before anything is read, so a list is never served
  // unless its audit entry was written (Nadia, Ezra, #51).
  await recordListView(db, 'hello_messages', sub)
  return { messages: await listHelloMessages(db) }
})
