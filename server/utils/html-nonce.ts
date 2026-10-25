const tagWithoutNonce = /<(script|style)(?![^>]*\bnonce=)([\s>])/g
// Empty attributes Nuxt renders on <html> and <body>; an inline style
// attribute, even an empty one, is a CSP violation under style-src 'self'.
const emptyAttribute = /\s(?:class|style)=""/g

/** Adds the nonce to every inline script and style tag that lacks one. */
export function addNonce(chunk: string, nonce: string): string {
  return chunk.replace(tagWithoutNonce, `<$1 nonce="${nonce}"$2`)
}

/** Removes empty class and style attributes. */
export function removeEmptyAttributes(attrs: string): string {
  return attrs.replace(emptyAttribute, '')
}
