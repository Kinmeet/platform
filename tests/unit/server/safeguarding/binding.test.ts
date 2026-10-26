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
})
