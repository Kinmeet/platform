/**
 * HMAC-SHA-256 as lower-case hex, with Web Crypto.
 *
 * Used wherever we need to recognise a value again without keeping it. The
 * key is a Worker secret, so the result cannot be reversed by guessing likely
 * values without it. Each purpose has its own secret and its own prefix, so a
 * leak or rotation of one never links the other:
 *
 * - `rate`: rate limit keys for a connection's network, keyed with
 *   `RATE_LIMIT_HMAC_KEY`.
 * - `email`: the email log's recipient, keyed with `EMAIL_LOG_HMAC_KEY`.
 *
 * Call `purposeHmac` rather than `hmacHex` so the prefix is never forgotten.
 */
export async function hmacHex(key: string, value: string): Promise<string> {
  if (!key) throw new Error('hmac_key_missing')
  const encoder = new TextEncoder()
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value))
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export type HmacPurpose = 'rate' | 'email'

/** HMAC of `${purpose}:${value}`, with the purpose's own key (see above). */
export function purposeHmac(purpose: HmacPurpose, key: string, value: string): Promise<string> {
  return hmacHex(key, `${purpose}:${value}`)
}
