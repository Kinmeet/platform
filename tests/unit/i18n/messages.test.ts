import { baseCompile } from '@intlify/message-compiler'
import { describe, expect, it } from 'vitest'
import messages from '../../../i18n/locales/en-GB.json'

type Tree = { [key: string]: string | Tree }

function leaves(tree: Tree, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[`${prefix}${key}`, value]] : leaves(value, `${prefix}${key}.`),
  )
}

// vue-i18n reads { } @ | as message syntax, so a stray one breaks the page
// at runtime (an email example with "@" did, on #15). Compile every message
// the way the site does and fail on any error.
describe('translation messages', () => {
  it.each(leaves(messages as Tree))('%s compiles', (_key, message) => {
    const errors: string[] = []
    baseCompile(message, { onError: (error) => errors.push(error.message) })
    expect(errors).toEqual([])
  })
})
