import { expect, test } from '@playwright/test'
import { DEFAULT_BODY_LIMIT, bodyLimits } from '../../shared/routes'

// ADR-0008 on the built Worker: the entry in front of Nitro refuses an
// oversized body with 413 and the P5 headers before anything reads it. Since
// ADR-0009 that entry is wired through Nitro's own `nitro.entry`, so this
// checks the wiring itself, not only `withBodyLimits` in a unit test. A
// change on upgrade that dropped the entry would fail here (Tech Lead, #137).

function expectSecurityHeaders(headers: Record<string, string>) {
  const policy = headers['content-security-policy'] ?? ''
  expect(policy).toContain("default-src 'self'")
  expect(policy).toContain("frame-ancestors 'none'")
  expect(headers['strict-transport-security']).toContain('preload')
  expect(headers['referrer-policy']).toBe('no-referrer')
  expect(headers['x-content-type-options']).toBe('nosniff')
  expect(headers['permissions-policy']).toContain('camera=()')
  expect(headers['cache-control']).toBe('no-store')
}

const helloLimit = bodyLimits['/api/hello']!

test('an oversized say hello body is refused with 413 and the security headers', async ({
  request,
}) => {
  const response = await request.post('/api/hello', {
    headers: { 'content-type': 'application/json' },
    // A Buffer, so the body is exactly this many bytes.
    data: Buffer.alloc(helloLimit + 1, 'a'),
  })
  expect(response.status()).toBe(413)
  expectSecurityHeaders(response.headers())
  expect(await response.body()).toHaveLength(0)
})

test('a body sent without a length is counted as it arrives and refused', async ({ baseURL }) => {
  // Chunked, so the entry can't rely on Content-Length.
  const chunk = new TextEncoder().encode('a'.repeat(4096))
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent > helloLimit) return controller.close()
      sent += chunk.length
      controller.enqueue(chunk)
    },
  })
  const response = await fetch(new URL('/api/hello', baseURL), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    duplex: 'half',
  } as RequestInit)
  expect(response.status).toBe(413)
  expectSecurityHeaders(Object.fromEntries(response.headers))
})

test('any other route takes only a small body', async ({ request }) => {
  const response = await request.post('/no-such-route', {
    data: Buffer.alloc(DEFAULT_BODY_LIMIT + 1, 'a'),
  })
  expect(response.status()).toBe(413)
  expectSecurityHeaders(response.headers())
})

test('a body within the limit reaches the route', async ({ request }) => {
  // The route answers itself: 400 for this input, or 503 where the form's
  // secrets aren't set, as in this local server. Only the entry sends 413.
  const response = await request.post('/api/hello', {
    headers: { 'content-type': 'application/json' },
    data: Buffer.alloc(helloLimit, 'a'),
  })
  expect(response.status()).not.toBe(413)
  expect([400, 503]).toContain(response.status())
})
