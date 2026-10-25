import { defineEventHandler } from 'h3'
import { listHelloMessages } from '../../utils/db/admin'
import { useDb } from '../../utils/db/env'

/** Say hello messages for the admin page, newest first. Behind Access. */
export default defineEventHandler(async (event) => ({
  messages: await listHelloMessages(useDb(event)),
}))
