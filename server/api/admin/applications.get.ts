import { defineEventHandler } from 'h3'
import { listApplications } from '../../utils/db/admin'
import { useDb } from '../../utils/db/env'

/** Applications for the admin page, newest first. Behind Access. */
export default defineEventHandler(async (event) => ({
  applications: await listApplications(useDb(event)),
}))
