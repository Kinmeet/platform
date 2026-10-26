import { defineEventHandler } from 'h3'
import { guardAdminRequest, isAdminPath } from '../utils/admin/guard'

// Runs after 00.security-headers.ts, so its refusals carry the P5 headers.
// Every request to the admin page or its API needs a valid Cloudflare Access
// token (#32). Everything else passes straight through.
export default defineEventHandler(async (event) => {
  if (!isAdminPath(event.path)) return
  const refusal = await guardAdminRequest(event)
  if (refusal) return refusal
})
