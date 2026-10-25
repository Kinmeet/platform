// Nuxt renders a small inline script for its runtime config. Rather than
// allowing 'unsafe-inline', the nonce from the security-headers middleware is
// added to the inline tags Nuxt writes.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.securityNonce as string | undefined
    if (nonce) applyNonce(html, nonce)
  })

  // Nuxt's renderer adds X-Powered-By to its own response after middleware has
  // run, so it is removed here, just before the response is sent.
  nitroApp.hooks.hook('beforeResponse', (event, response) => {
    removeResponseHeader(event, 'X-Powered-By')
    const body = response.body as { headers?: unknown } | undefined
    if (body?.headers instanceof Headers) body.headers.delete('X-Powered-By')
  })
})
