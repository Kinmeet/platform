import { bodyLimitFor } from '../../shared/routes'
import { buildSecurityHeaders } from '../utils/security-headers'

/**
 * Runs in front of Nitro (worker/index.mjs). Nitro's Cloudflare handler reads
 * every body into memory before any route code runs, so the per-route caps
 * are enforced here instead (issue #54).
 *
 * Returns the request to hand to Nitro, or a 413 response. The body is never
 * logged or kept: a refused body is cancelled, an accepted one is passed on.
 */
export async function limitRequestBody(
  request: Request,
  limitFor: (method: string, path: string) => number = bodyLimitFor,
): Promise<Request | Response> {
  if (request.body === null) return request

  const path = new URL(request.url).pathname
  const limit = limitFor(request.method, path)

  // Refuse early when the declared length is already too big.
  const declared = Number(request.headers.get('Content-Length'))
  if (Number.isFinite(declared) && declared > limit) {
    await request.body.cancel()
    return tooLarge(path)
  }

  // Count what actually arrives, whatever the headers say (chunked bodies
  // have no Content-Length). Limits are at most a few tens of KB, so the
  // accepted body is held here and handed to Nitro as it is.
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      return tooLarge(path)
    }
    chunks.push(value)
  }

  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  // GET and HEAD may not carry a body at all, even an empty one.
  return new Request(request, { body: total === 0 ? null : body })
}

function tooLarge(path: string): Response {
  return new Response(null, {
    status: 413,
    headers: {
      ...buildSecurityHeaders({ path }),
      'Cache-Control': 'no-store',
    },
  })
}
