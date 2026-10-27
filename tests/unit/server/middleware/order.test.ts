import { createApp, defineEventHandler, toWebHandler, type EventHandler } from 'h3'
import { describe, expect, it } from 'vitest'
import { buildSecurityHeaders } from '../../../../server/utils/security-headers'

// Nitro runs server/middleware in file-name order. This loads every middleware
// file, sorts the names the same way and runs them in that order, so a rename
// that lets a refusal go out before the security headers are set fails here.
const modules = import.meta.glob<{ default: EventHandler }>('../../../../server/middleware/*.ts', {
  eager: true,
})
const names = Object.keys(modules).sort()

function app() {
  const instance = createApp()
  for (const name of names) instance.use(modules[name]!.default)
  instance.use(defineEventHandler(() => 'ok'))
  // No Cloudflare env, so the admin guard fails closed.
  return toWebHandler(instance, { cloudflare: { env: {} } } as never)
}

describe('server middleware order', () => {
  it('runs the security headers first', () => {
    expect(names[0]).toMatch(/\/00\.security-headers\.ts$/)
  })

  it('sends the P5 headers on the admin refusal', async () => {
    const response = await app()(new Request('https://kinmeet-staging.kinmeet.workers.dev/admin'))
    expect(response.status).toBe(403)
    const expected = buildSecurityHeaders({ path: '/admin', nonce: 'x' })
    for (const name of Object.keys(expected)) {
      expect(response.headers.get(name), name).not.toBeNull()
    }
    expect(response.headers.get('Content-Security-Policy')).toMatch(/nonce-/)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow')
  })

  it('sends the P5 headers on the admin API refusal too', async () => {
    const response = await app()(
      new Request('https://kinmeet-staging.kinmeet.workers.dev/api/admin/messages'),
    )
    expect(response.status).toBe(403)
    expect(response.headers.get('Content-Security-Policy')).not.toBeNull()
    expect(response.headers.get('X-Frame-Options')).toBe('DENY')
  })
})
