const encoder = new TextEncoder()

/** Trims and lower-cases an address so the same inbox always gives the same HMAC. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase()
}

/**
 * A keyed HMAC-SHA-256 of an email address, as lower-case hex. The send log
 * keeps this instead of the address (P3, Privacy and Safeguarding Reviewer):
 * a later bounce or "did my email arrive?" check hashes the address it has
 * and looks that up. The key is a Worker secret, so the log alone cannot be
 * matched against a list of guessed addresses.
 */
export async function hmacAddress(key: string, address: string): Promise<string> {
  if (!key) throw new Error('email_log_hmac_key_missing')
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    encoder.encode(normaliseAddress(address)),
  )
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
