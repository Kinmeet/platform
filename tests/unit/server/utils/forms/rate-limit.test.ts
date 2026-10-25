import { describe, expect, it } from 'vitest'
import { hmacHex } from '../../../../../server/utils/forms/hmac'
import { withinRateLimit, type RateLimiter } from '../../../../../server/utils/forms/rate-limit'

// A documentation-range address (RFC 5737), never a real one.
const IP = '192.0.2.10'
const KEY = 'test-only-hmac-key'

function limiter(success = true) {
  const keys: string[] = []
  const fake: RateLimiter = {
    async limit({ key }) {
      keys.push(key)
      return { success }
    },
  }
  return { fake, keys }
}

describe('withinRateLimit', () => {
  it('keys the per-connection limiter on an HMAC of the address, never the address', async () => {
    const perConnection = limiter()
    const global = limiter()
    const allowed = await withinRateLimit({
      form: 'hello',
      ip: IP,
      hmacKey: KEY,
      perConnection: perConnection.fake,
      global: global.fake,
    })
    expect(allowed).toBe(true)
    expect(global.keys).toEqual(['hello'])
    expect(perConnection.keys).toEqual([`hello:${await hmacHex(KEY, IP)}`])
    expect(perConnection.keys.join()).not.toContain(IP)
  })

  it('refuses when either limiter is over its limit', async () => {
    const options = { form: 'apply', ip: IP, hmacKey: KEY }
    expect(
      await withinRateLimit({
        ...options,
        perConnection: limiter(false).fake,
        global: limiter().fake,
      }),
    ).toBe(false)
    const perConnection = limiter()
    expect(
      await withinRateLimit({
        ...options,
        perConnection: perConnection.fake,
        global: limiter(false).fake,
      }),
    ).toBe(false)
    expect(perConnection.keys).toEqual([])
  })

  it('still applies the global limiter without an address', async () => {
    const global = limiter(false)
    expect(
      await withinRateLimit({
        form: 'hello',
        ip: null,
        hmacKey: KEY,
        perConnection: limiter().fake,
        global: global.fake,
      }),
    ).toBe(false)
  })
})
