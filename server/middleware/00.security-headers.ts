import { defineEventHandler, setResponseHeaders } from 'h3'
import { buildSecurityHeaders, createNonce } from '../utils/security-headers'

// Nitro runs server middleware in file-name order. The number prefix keeps
// this one first, so every response, including another middleware's refusal
// (such as the admin 403), carries the P5 headers. A test checks the order.
//
// Sets the security headers on every response the Worker renders. Each
// request gets a fresh nonce, which the security-nonce plugin adds to the
// inline script and style tags that Nuxt renders.
export default defineEventHandler((event) => {
  const nonce = createNonce()
  event.context.securityNonce = nonce
  setResponseHeaders(event, {
    ...buildSecurityHeaders({ path: event.path, nonce }),
    // A response carrying a nonce must never be cached and shared.
    'Cache-Control': 'no-store',
  })
})
