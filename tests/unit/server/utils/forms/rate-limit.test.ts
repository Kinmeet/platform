import { describe, expect, it } from 'vitest'
import { hmacHex } from '../../../../../server/utils/forms/hmac'
import {
  networkOf,
  withinRateLimit,
  type RateLimiter,
} from '../../../../../server/utils/forms/rate-limit'

// Documentation-range addresses (RFC 5737, RFC 3849), never real ones.
const IPV4 = '192.0.2.10'
const IPV6 = '2001:db8:1234:5678:9abc:def0:1:2'
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

describe('networkOf', () => {
  it('keeps an IPv4 address whole', () => {
    expect(networkOf(IPV4)).toBe(IPV4)
  })

  it('keys IPv6 by its /64, however it is written', () => {
    expect(networkOf(IPV6)).toBe('2001:db8:1234:5678::/64')
    expect(networkOf('2001:DB8:1234:5678::1')).toBe('2001:db8:1234:5678::/64')
    expect(networkOf('2001:0db8:1234:5678:0000:0000:0000:0001')).toBe('2001:db8:1234:5678::/64')
    expect(networkOf('2001:db8::1')).toBe('2001:db8:0:0::/64')
    expect(networkOf('::1')).toBe('0:0:0:0::/64')
  })

  it('treats an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(networkOf('::ffff:192.0.2.10')).toBe(IPV4)
    expect(networkOf('::ffff:c000:20a')).toBe(IPV4)
  })

  it('returns null for anything that is not an address', () => {
    for (const value of [
      '',
      'unknown',
      '256.0.0.1',
      '1.2.3',
      '2001:db8::1::2',
      '2001:db8:g::1',
      '1:2:3:4:5:6:7:8:9',
    ]) {
      expect(networkOf(value)).toBeNull()
    }
  })
})

describe('withinRateLimit', () => {
  it('keys the per-network limiter on an HMAC of the network, never the address', async () => {
    const perNetwork = limiter()
    const global = limiter()
    const allowed = await withinRateLimit({
      form: 'hello',
      ip: IPV6,
      hmacKey: KEY,
      perNetwork: perNetwork.fake,
      global: global.fake,
    })
    expect(allowed).toBe(true)
    expect(perNetwork.keys).toEqual([`hello:${await hmacHex(KEY, '2001:db8:1234:5678::/64')}`])
    expect(global.keys).toEqual(['hello'])
    expect(perNetwork.keys.join()).not.toContain('2001')
  })

  it('counts two addresses in one IPv6 /64 together', async () => {
    const perNetwork = limiter()
    for (const ip of [IPV6, '2001:db8:1234:5678::ffff']) {
      await withinRateLimit({
        form: 'hello',
        ip,
        hmacKey: KEY,
        perNetwork: perNetwork.fake,
        global: limiter().fake,
      })
    }
    expect(new Set(perNetwork.keys).size).toBe(1)
  })

  it('checks the per-network limit before the global one', async () => {
    const global = limiter()
    expect(
      await withinRateLimit({
        form: 'apply',
        ip: IPV4,
        hmacKey: KEY,
        perNetwork: limiter(false).fake,
        global: global.fake,
      }),
    ).toBe(false)
    expect(global.keys).toEqual([])
    expect(
      await withinRateLimit({
        form: 'apply',
        ip: IPV4,
        hmacKey: KEY,
        perNetwork: limiter().fake,
        global: limiter(false).fake,
      }),
    ).toBe(false)
  })

  it('still applies the global limiter without a usable address', async () => {
    for (const ip of [null, 'unknown']) {
      const perNetwork = limiter()
      expect(
        await withinRateLimit({
          form: 'hello',
          ip,
          hmacKey: KEY,
          perNetwork: perNetwork.fake,
          global: limiter(false).fake,
        }),
      ).toBe(false)
      expect(perNetwork.keys).toEqual([])
    }
  })
})
