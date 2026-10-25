const encoder = new TextEncoder()

/** Trims and lower-cases an address so the same inbox always gives the same HMAC. */
export function normaliseAddress(address: string): string {
  return address.trim().toLowerCase()
}

const gmailDomains = new Set(['gmail.com', 'googlemail.com'])

/**
 * The inbox an address reaches, so one person cannot be sent many receipts
 * through `name+1@`, `name+2@` or, for Gmail, dotted variants (Security
 * Reviewer). Drops a `+tag` for every domain; for Gmail also removes dots
 * and treats both Gmail domains as one. The send log's `to_hmac` is taken
 * from this form; mail is always sent to the address exactly as given.
 */
export function inboxAddress(address: string): string {
  const normalised = normaliseAddress(address)
  const at = normalised.lastIndexOf('@')
  if (at < 1) return normalised
  let local = normalised.slice(0, at)
  let domain = normalised.slice(at + 1)
  const plus = local.indexOf('+')
  if (plus > 0) local = local.slice(0, plus)
  if (gmailDomains.has(domain)) {
    local = local.replaceAll('.', '')
    domain = 'gmail.com'
  }
  return `${local}@${domain}`
}

/**
 * Refuses an address that could add a mail header once a real transport
 * exists: any control character (CR and LF included) or more than one `@`.
 * The forms schema refuses these too; this is the backstop every caller
 * goes through.
 */
export function assertSendableAddress(address: string): void {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(address) || address.split('@').length !== 2) {
    throw new Error('email_invalid_address')
  }
}

/**
 * A keyed HMAC-SHA-256 of an email address, as lower-case hex. The send log
 * keeps this instead of the address (P3, Privacy and Safeguarding Reviewer):
 * a later bounce or "did my email arrive?" check hashes the inbox form of
 * the address it has and looks that up. The key is a Worker secret, so the log alone cannot be
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
