import { purposeHmac } from './hmac'

/**
 * Rate limiting with Cloudflare's rate limiting binding
 * (docs/api/forms.md, "Rate limiting").
 *
 * The per-network key is `${form}:${hmac(network)}`, where the network is the
 * full IPv4 address or the first 64 bits of an IPv6 address. The raw address
 * is never used as a key, stored or logged, and the counts live only inside
 * Cloudflare. A global per-form limiter is the flood backstop. Both limits are
 * approximate (counted per Cloudflare location); Turnstile is the real gate.
 */

/** The binding's `limit()` call, so tests can supply a fake. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** Matches the limiters' period in `wrangler.jsonc`. */
export const RATE_LIMIT_PERIOD_SECONDS = 60

/** Expands an IPv6 address to eight groups, or returns `null` if it is not one. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase()
  // An embedded IPv4 tail (for example ::ffff:192.0.2.1) becomes two groups.
  const v4Tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text)
  if (v4Tail) {
    const [a, b, c, d] = v4Tail.slice(1).map(Number) as [number, number, number, number]
    if ([a, b, c, d].some((part) => part > 255)) return null
    text = `${text.slice(0, v4Tail.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }
  const halves = text.split('::')
  if (halves.length > 2) return null
  const parse = (part: string) => (part === '' ? [] : part.split(':'))
  const head = parse(halves[0] ?? '')
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail]
  if (groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.map((group) => parseInt(group, 16))
}

/**
 * The network a connection is counted under: the IPv4 address itself, or the
 * /64 of an IPv6 address (an IPv4-mapped IPv6 address counts as its IPv4).
 * Returns `null` for anything that is not an address.
 */
export function networkOf(address: string): string | null {
  const trimmed = address.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(trimmed)) {
    return trimmed.split('.').every((part) => Number(part) <= 255) ? trimmed : null
  }
  const groups = ipv6Groups(trimmed)
  if (groups === null) return null
  const mapped = groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  if (mapped) {
    const [high = 0, low = 0] = groups.slice(6)
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.')
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::/64`
}

export interface RateLimitOptions {
  form: string
  ip: string | null
  hmacKey: string
  perNetwork: RateLimiter
  global: RateLimiter
}

/** True when the request may go ahead: the per-network limit, then the global one. */
export async function withinRateLimit({
  form,
  ip,
  hmacKey,
  perNetwork,
  global,
}: RateLimitOptions): Promise<boolean> {
  const network = ip ? networkOf(ip) : null
  // Without a usable address (only in local tests) the global limiter still applies.
  if (network !== null) {
    const key = `${form}:${await purposeHmac('rate', hmacKey, network)}`
    if (!(await perNetwork.limit({ key })).success) return false
  }
  return (await global.limit({ key: form })).success
}
