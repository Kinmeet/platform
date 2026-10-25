/**
 * Checks every form request must pass before its body is parsed
 * (docs/api/forms.md, "Same origin only" and "Body size cap").
 */

export type BodyRead = { ok: true; text: string } | { ok: false }
export type JsonParse = { ok: true; body: Record<string, unknown> } | { ok: false }

const JSON_CONTENT_TYPE = /^application\/json(\s*;\s*charset=utf-8)?$/i

/**
 * Same origin only: a JSON POST whose `Origin` is this environment's
 * configured site (never worked out from the request's `Host`; see
 * `site-origin.ts`). A missing or `null` origin is refused.
 */
export function isSameOriginJsonPost(
  request: Request,
  originAllowed: (origin: string | null) => boolean,
): boolean {
  if (request.method !== 'POST') return false
  if (!originAllowed(request.headers.get('Origin'))) return false
  const fetchSite = request.headers.get('Sec-Fetch-Site')
  if (fetchSite !== null && fetchSite !== 'same-origin') return false
  return JSON_CONTENT_TYPE.test((request.headers.get('Content-Type') ?? '').trim())
}

/**
 * Reads the body as UTF-8 text, counting bytes from the stream and stopping
 * as soon as `maxBytes` is passed, so a large body is never buffered.
 * `Content-Length` is never trusted.
 */
export async function readCappedBody(request: Request, maxBytes: number): Promise<BodyRead> {
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
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { ok: false }
  }
}

/** Parses a body that must be a JSON object. */
export function parseJsonObject(text: string): JsonParse {
  try {
    const body: unknown = JSON.parse(text)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return { ok: false }
    return { ok: true, body: body as Record<string, unknown> }
  } catch {
    return { ok: false }
  }
}
