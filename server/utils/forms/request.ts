/**
 * Checks every form request must pass before its body is read
 * (docs/api/forms.md, "Same origin only" and "Body size cap").
 */

/** Bodies over 16 KB are refused before parsing. */
export const MAX_BODY_BYTES = 16 * 1024

export type RequestCheck = { ok: true; body: unknown } | { ok: false }

/** Same origin only: JSON over POST from our own pages, with no CORS. */
export function isSameOriginJsonPost(request: Request): boolean {
  if (request.method !== 'POST') return false
  const origin = request.headers.get('Origin')
  if (origin === null || origin !== new URL(request.url).origin) return false
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return false
  const contentType = request.headers.get('Content-Type') ?? ''
  return contentType.split(';')[0]?.trim().toLowerCase() === 'application/json'
}

/**
 * Reads at most `MAX_BODY_BYTES` of the body and parses it as JSON. Stops
 * reading as soon as the cap is passed, so a large body is never buffered,
 * and does not trust `Content-Length`.
 */
export async function readCappedJson(
  request: Request,
  maxBytes = MAX_BODY_BYTES,
): Promise<RequestCheck> {
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false }
  if (request.body === null) return { ok: false }

  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      return { ok: false }
    }
    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
    return { ok: true, body }
  } catch {
    return { ok: false }
  }
}
