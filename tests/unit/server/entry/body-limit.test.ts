import { describe, expect, it } from 'vitest'
import { limitRequestBody } from '../../../../server/entry/body-limit'
import { bodyLimitFor } from '../../../../shared/routes'

const ORIGIN = 'https://kinmeet-staging.kinmeet.workers.dev'

function bytes(length: number): Uint8Array {
  return new Uint8Array(length).fill(0x61)
}

/** A body with no Content-Length, sent in pieces, as a chunked upload is. */
function chunked(sizes: number[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const size of sizes) controller.enqueue(bytes(size))
      controller.close()
    },
  })
}

function post(path: string, body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}${path}`, { method: 'POST', body, headers })
}

async function refused(result: Request | Response): Promise<Response> {
  expect(result).toBeInstanceOf(Response)
  const response = result as Response
  expect(response.status).toBe(413)
  return response
}

describe('request body limits', () => {
  it('refuses a body whose Content-Length is over the route limit', async () => {
    // Only the header is over: the check must not need to read the body.
    const request = post('/api/hello', chunked([10]), { 'Content-Length': String(22 * 1024 + 1) })
    await refused(await limitRequestBody(request))
  })

  it('refuses an oversized chunked body as it arrives', async () => {
    const request = post('/api/hello', chunked([16 * 1024, 16 * 1024]))
    expect(request.headers.get('Content-Length')).toBeNull()
    await refused(await limitRequestBody(request))
  })

  it('refuses a body larger than its declared Content-Length claims', async () => {
    // Content-Length is never trusted: the bytes are counted as well.
    const limitFor = () => 10
    const request = post('/api/hello', chunked([8, 8]), { 'Content-Length': '5' })
    await refused(await limitRequestBody(request, limitFor))
  })

  it('drops a Content-Length that does not match the body passed on', async () => {
    const limitFor = () => 100
    const result = await limitRequestBody(
      post('/api/hello', chunked([8, 8]), { 'Content-Length': '5' }),
      limitFor,
    )
    expect(result).toBeInstanceOf(Request)
    expect((result as Request).headers.get('Content-Length')).toBeNull()
    expect((await (result as Request).arrayBuffer()).byteLength).toBe(16)
  })

  it('accepts a body of exactly the limit and passes it on unchanged', async () => {
    const body = bytes(22 * 1024)
    const result = await limitRequestBody(post('/api/hello', chunked([11 * 1024, 11 * 1024])))
    expect(result).toBeInstanceOf(Request)
    const passed = new Uint8Array(await (result as Request).arrayBuffer())
    expect(passed).toEqual(body)
  })

  it('allows the larger apply form its own limit', async () => {
    const result = await limitRequestBody(post('/api/apply', bytes(64 * 1024)))
    expect(result).toBeInstanceOf(Request)
    await refused(await limitRequestBody(post('/api/apply', bytes(64 * 1024 + 1))))
  })

  it('gives an unknown route only the small default limit', async () => {
    const accepted = await limitRequestBody(post('/no-such-route', bytes(1024)))
    expect(accepted).toBeInstanceOf(Request)
    await refused(await limitRequestBody(post('/no-such-route', bytes(1025))))
  })

  it('passes a request with no body straight through', async () => {
    const request = new Request(`${ORIGIN}/`)
    expect(await limitRequestBody(request)).toBe(request)
  })

  it('keeps the security headers on the 413 response', async () => {
    const response = await refused(await limitRequestBody(post('/api/hello', bytes(23 * 1024))))
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'self'")
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'")
    expect(response.headers.get('Strict-Transport-Security')).toContain('preload')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('')
  })
})

describe('bodyLimitFor', () => {
  it('uses the form caps from the route list', () => {
    expect(bodyLimitFor('POST', '/api/hello')).toBe(22 * 1024)
    expect(bodyLimitFor('POST', '/api/hello/')).toBe(22 * 1024)
    expect(bodyLimitFor('POST', '/api/apply')).toBe(64 * 1024)
  })

  it('allows no body on GET or HEAD for other routes', () => {
    expect(bodyLimitFor('GET', '/')).toBe(0)
    expect(bodyLimitFor('HEAD', '/anything')).toBe(0)
  })

  it('allows a small body on other methods for other routes', () => {
    expect(bodyLimitFor('POST', '/anything')).toBe(1024)
  })
})
