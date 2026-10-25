import { describe, expect, it } from 'vitest'
import { hmacHex } from '../../../../../server/utils/forms/hmac'

describe('hmacHex', () => {
  it('matches the RFC 4231 HMAC-SHA-256 test vector', async () => {
    expect(await hmacHex('Jefe', 'what do ya want for nothing?')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    )
  })

  it('refuses an empty key', async () => {
    await expect(hmacHex('', 'value')).rejects.toThrow('hmac_key_missing')
  })
})
