import { describe, expect, it } from 'vitest'

// Nadia's condition 4 on #95: plaintext exists in one place. Only
// server/safeguarding/ may touch the encrypted table, and only its store
// reads the key secrets. Names are built here so this file does not match.
const KEY = ['SAFEGUARDING', 'KEY'].join('_')
const TABLE = ['safeguarding', 'items'].join('_')

const sources = import.meta.glob<string>(
  ['../../../../app/**/*.{ts,vue}', '../../../../server/**/*.ts', '../../../../shared/**/*.ts'],
  { query: '?raw', import: 'default', eager: true },
)

const naming = (name: string) =>
  Object.entries(sources)
    .filter(([, text]) => text.includes(name))
    .map(([path]) => path.replace(/^(\.\.\/)+/, ''))
    .sort()

describe('the safeguarding store', () => {
  it('is the only code that reads the key secrets', () => {
    expect(naming(KEY)).toEqual(['server/safeguarding/store.ts'])
  })

  it('is the only code that names the encrypted table, with the hand-over', () => {
    expect(naming(TABLE)).toEqual([
      'server/safeguarding/crypto.ts',
      'server/safeguarding/handover.ts',
      'server/safeguarding/store.ts',
    ])
  })

  // Nadia, #91: `open` has no role check of its own, so only the acting
  // lead's reader route (#93) may import the store from outside this folder.
  // That route adds itself here, and nothing else may.
  it('is imported from outside server/safeguarding/ only by the reader route', () => {
    const READER_ROUTES: string[] = []
    const importing = Object.entries(sources)
      .filter(([, text]) => /from\s+['"][^'"]*safeguarding\/store['"]/.test(text))
      .map(([path]) => path.replace(/^(\.\.\/)+/, ''))
      .filter((path) => !path.startsWith('server/safeguarding/'))
    expect(importing.sort()).toEqual(READER_ROUTES)
  })
})
