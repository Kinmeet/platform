// Nuxt renders a small inline script for its runtime config. Rather than
// allowing 'unsafe-inline', the nonce from the security-headers middleware is
// added to every inline script and style tag.
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:html', (html, { event }) => {
    const nonce = event.context.securityNonce as string | undefined
    if (!nonce) return
    const withNonce = (chunks: string[]) => chunks.map((chunk) => addNonce(chunk, nonce))
    html.head = withNonce(html.head)
    html.bodyPrepend = withNonce(html.bodyPrepend)
    html.body = withNonce(html.body)
    html.bodyAppend = withNonce(html.bodyAppend)
    html.htmlAttrs = html.htmlAttrs.map(removeEmptyAttributes)
    html.bodyAttrs = html.bodyAttrs.map(removeEmptyAttributes)
  })
})
