/**
 * HMAC-SHA-256 as lower-case hex, with Web Crypto.
 *
 * Used wherever we need to recognise a value again without keeping it: the
 * rate limit key for a connection's IP address, and the email log's
 * recipient. The key is a Worker secret, so the result cannot be reversed by
 * guessing likely values without it.
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
