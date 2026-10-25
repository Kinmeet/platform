import { describe, expect, it } from 'vitest'
import { publicRoutes, isFormRoute } from '../../../../shared/routes'
import {
  TURNSTILE_ORIGIN,
  buildContentSecurityPolicy,
  buildSecurityHeaders,
  createNonce,
} from '../../../../server/utils/security-headers'
import { addNonce, applyNonce, removeEmptyAttributes } from '../../../../server/utils/html-nonce'

function directives(policy: string): Map<string, string> {
  return new Map(
    policy.split(';').map((part) => {
      const [name = '', ...values] = part.trim().split(/\s+/)
      return [name, values.join(' ')]
    }),
  )
}

describe('security headers', () => {
  const headers = buildSecurityHeaders({ path: '/' })

  it('sets every header P5 requires', () => {
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    )
    expect(headers['Referrer-Policy']).toBe('no-referrer')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin')
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin')
  })

  it('keeps passkeys available on our own origin only', () => {
    expect(headers['Permissions-Policy']).toContain('publickey-credentials-create=(self)')
    expect(headers['Permissions-Policy']).toContain('publickey-credentials-get=(self)')
  })

  it('turns off powerful browser features', () => {
    for (const feature of ['camera', 'microphone', 'geolocation', 'payment', 'browsing-topics']) {
      expect(headers['Permissions-Policy']).toContain(`${feature}=()`)
    }
  })
})

describe('content security policy', () => {
  it('allows only our own origin on ordinary pages', () => {
    const policy = directives(buildContentSecurityPolicy({ path: '/' }))
    expect(policy.get('default-src')).toBe("'self'")
    expect(policy.get('script-src')).toBe("'self'")
    expect(policy.get('style-src')).toBe("'self'")
    expect(policy.get('connect-src')).toBe("'self'")
    expect(policy.get('frame-src')).toBe("'none'")
    expect(policy.get('frame-ancestors')).toBe("'none'")
    expect(policy.get('object-src')).toBe("'none'")
    expect(policy.get('base-uri')).toBe("'none'")
    expect(policy.has('upgrade-insecure-requests')).toBe(true)
  })

  it('never allows unsafe-inline or unsafe-eval', () => {
    for (const route of publicRoutes) {
      const policy = buildContentSecurityPolicy({ path: route.path, nonce: 'abc' })
      expect(policy).not.toContain('unsafe-inline')
      expect(policy).not.toContain('unsafe-eval')
      expect(policy).not.toContain('*')
    }
  })

  it('never allows Turnstile on a page that is not a form page', () => {
    for (const route of publicRoutes.filter((r) => !r.form)) {
      expect(buildContentSecurityPolicy({ path: route.path })).not.toContain(TURNSTILE_ORIGIN)
    }
  })

  it('allows Turnstile scripts and frames only on form pages', () => {
    const formPath = '/test-form-page'
    const routes = [...publicRoutes, { path: formPath, form: true }]
    const policy = directives(buildContentSecurityPolicy({ path: formPath, routes }))
    expect(policy.get('script-src')).toBe(`'self' ${TURNSTILE_ORIGIN}`)
    expect(policy.get('frame-src')).toBe(TURNSTILE_ORIGIN)
    expect(policy.get('connect-src')).toBe("'self'")
    expect(isFormRoute(`${formPath}/`, routes)).toBe(true)
    expect(isFormRoute(`${formPath}?step=2`, routes)).toBe(true)
    expect(isFormRoute(formPath)).toBe(false)
  })

  it('adds the nonce to scripts and styles only', () => {
    const policy = directives(buildContentSecurityPolicy({ path: '/', nonce: 'n0nce' }))
    expect(policy.get('script-src')).toBe("'self' 'nonce-n0nce'")
    expect(policy.get('style-src')).toBe("'self' 'nonce-n0nce'")
    expect(policy.get('img-src')).toBe("'self' data:")
  })
})

describe('nonces', () => {
  it('creates a different 16-byte nonce each time', () => {
    const a = createNonce()
    const b = createNonce()
    expect(a).not.toBe(b)
    expect(atob(a)).toHaveLength(16)
  })

  it('adds the nonce to inline script and style tags without one', () => {
    const html = '<script>a()</script><style>b{}</style><script nonce="x">c()</script><scripts>'
    expect(addNonce(html, 'n')).toBe(
      '<script nonce="n">a()</script><style nonce="n">b{}</style><script nonce="x">c()</script><scripts>',
    )
  })
})

describe('empty attributes', () => {
  it('removes empty class and style attributes but keeps others', () => {
    expect(removeEmptyAttributes(' lang="en-GB" class="" style=""')).toBe(' lang="en-GB"')
  })
})

describe('applying the nonce to a rendered page', () => {
  function page() {
    return {
      head: [
        '<script type="importmap">{}</script><script type="module" src="/_nuxt/a.js"></script>',
      ],
      bodyPrepend: ['<script>prepended()</script>'],
      body: ['<main><p>Hello</p><script>injected()</script></main>'],
      bodyAppend: ['<script>window.__NUXT__={}</script>'],
      htmlAttrs: [' lang="en-GB" class=""'],
      bodyAttrs: [' style=""'],
    }
  }

  it('stamps the tags Nuxt writes in head and bodyAppend', () => {
    const html = page()
    applyNonce(html, 'n')
    expect(html.head[0]).toBe(
      '<script nonce="n" type="importmap">{}</script><script nonce="n" type="module" src="/_nuxt/a.js"></script>',
    )
    expect(html.bodyAppend[0]).toBe('<script nonce="n">window.__NUXT__={}</script>')
    expect(html.htmlAttrs[0]).toBe(' lang="en-GB"')
    expect(html.bodyAttrs[0]).toBe('')
  })

  it('never stamps a script that reached the rendered page content', () => {
    const html = page()
    applyNonce(html, 'n')
    expect(html.body[0]).toBe('<main><p>Hello</p><script>injected()</script></main>')
    expect(html.bodyPrepend[0]).toBe('<script>prepended()</script>')
  })
})
