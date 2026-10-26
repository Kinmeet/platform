import { describe, expect, it } from 'vitest'
import { hmacHex, purposeHmac } from '../../../../../server/utils/forms/hmac'

describe('hmacHex', () => {
  it('matches the RFC 4231 HMAC-SHA-256 test vector', async () => {
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('refuses an empty key', async () => {
    await expect(hmacHex('', 'value')).rejects.toThrow('hmac_key_missing')
  })

  it('prefixes the value with its purpose, so the same value differs per purpose', async () => {
    expect(await purposeHmac('rate', 'Jefe', '192.0.2.10')).toBe(
      await hmacHex('Jefe', 'rate:192.0.2.10'),
    )
    expect(await purposeHmac('rate', 'Jefe', 'x')).not.toBe(await purposeHmac('email', 'Jefe', 'x'))
  })
})
