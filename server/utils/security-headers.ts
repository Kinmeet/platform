import { isFormRoute, type PublicRoute } from '../../shared/routes'

/** The only third-party origin any page may load, and only on form pages (S5). */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com'

export interface SecurityHeaderOptions {
  /** Request path, used to decide whether Turnstile is allowed. */
  path: string
  /** Per-response nonce for inline scripts and styles that Nuxt renders. */
  nonce?: string
  /** Route list to check against; defaults to every public route. */
  routes?: readonly PublicRoute[]
  /**
   * Local `nuxt dev` only. Vite injects styles at run time without a nonce and
   * talks to its dev server over a WebSocket, so the dev policy allows inline
   * styles and `ws:` connections. Never set for a built Worker.
   */
  dev?: boolean
}

export function buildContentSecurityPolicy({
  path,
  nonce,
  routes,
  dev = false,
}: SecurityHeaderOptions): string {
  const form = isFormRoute(path, routes)
  const nonceSource = nonce ? ` 'nonce-${nonce}'` : ''
  // A nonce makes browsers ignore 'unsafe-inline', so dev leaves it out of style-src.
  const styleSource = dev ? "'self' 'unsafe-inline'" : `'self'${nonceSource}`
  const turnstile = form ? ` ${TURNSTILE_ORIGIN}` : ''

  const directives: Record<string, string> = {
    'default-src': "'self'",
    'script-src': `'self'${nonceSource}${turnstile}`,
    'style-src': styleSource,
    'img-src': "'self' data:",
    'font-src': "'self'",
    'connect-src': dev ? "'self' ws:" : "'self'",
    'frame-src': form ? TURNSTILE_ORIGIN : "'none'",
    'worker-src': "'self'",
    'manifest-src': "'self'",
    'media-src': "'self'",
    'object-src': "'none'",
    'base-uri': "'none'",
    'form-action': "'self'",
    'frame-ancestors': "'none'",
  }

  return [
    ...Object.entries(directives).map(([name, value]) => `${name} ${value}`),
    'upgrade-insecure-requests',
  ].join('; ')
}

export function buildSecurityHeaders(options: SecurityHeaderOptions): Record<string, string> {
  return {
    'Content-Security-Policy': buildContentSecurityPolicy(options),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': [
      'accelerometer=()',
      'autoplay=()',
      'browsing-topics=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=()',
      'geolocation=()',
      'gyroscope=()',
      'interest-cohort=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      // Passkeys are the main way to sign in (P5), so WebAuthn stays on for our own origin.
      'publickey-credentials-create=(self)',
      'publickey-credentials-get=(self)',
      'screen-wake-lock=()',
      'serial=()',
      'usb=()',
      'xr-spatial-tracking=()',
    ].join(', '),
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'X-DNS-Prefetch-Control': 'off',
    'X-Permitted-Cross-Domain-Policies': 'none',
  }
}

/** Generates a nonce from 16 random bytes, base64 encoded. */
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...bytes))
}
