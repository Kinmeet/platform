import type { NuxtRenderHTMLContext } from 'nuxt/app'

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

type HtmlParts = Pick<NuxtRenderHTMLContext, 'head' | 'bodyAppend' | 'htmlAttrs' | 'bodyAttrs'>

/**
 * Adds the nonce to the tags Nuxt itself writes, which are all in `head`
 * (import map, entry module) and `bodyAppend` (runtime config, payload).
 * `body` and `bodyPrepend` hold the rendered app and are never stamped, so a
 * tag injected into page content by a bug does not get a valid nonce.
 */
export function applyNonce(html: HtmlParts, nonce: string): void {
  html.head = html.head.map((chunk) => addNonce(chunk, nonce))
  html.bodyAppend = html.bodyAppend.map((chunk) => addNonce(chunk, nonce))
  html.htmlAttrs = html.htmlAttrs.map(removeEmptyAttributes)
  html.bodyAttrs = html.bodyAttrs.map(removeEmptyAttributes)
}
