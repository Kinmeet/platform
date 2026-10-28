import type { H3Event } from 'h3'
import { getRequestHeader, toWebRequest } from 'h3'
import { parseJsonObject, readCappedBody } from '../forms/request'

const JSON_CONTENT_TYPE = /^application\/json(\s*;\s*charset=utf-8)?$/i

/**
 * The JSON object an admin action sends, or `null`. The body is counted as
 * it arrives and refused past `maxBytes`, never trusting `Content-Length`,
 * behind the Worker entry's own limit for the route (`shared/routes.ts`).
 * The admin middleware has already checked the Access token and the origin.
 */
export async function readAdminJson(
  event: H3Event,
  maxBytes: number,
): Promise<Record<string, unknown> | null> {
  if (!JSON_CONTENT_TYPE.test((getRequestHeader(event, 'Content-Type') ?? '').trim())) return null
  const read = await readCappedBody(toWebRequest(event), maxBytes)
  if (!read.ok) return null
  const parsed = parseJsonObject(read.text)
  return parsed.ok ? parsed.body : null
}
