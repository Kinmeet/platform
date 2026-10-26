import { describe, expect, it } from 'vitest'

// Nadia's condition on #36: Workers cannot limit a binding to one route, so
// the code does. Only files in server/safeguarding/ may name the interim
// safeguarding store's binding.
const NAME = ['SAFEGUARDING', 'DB'].join('_')

const sources = import.meta.glob<string>(
  ['../../../../app/**/*.{ts,vue}', '../../../../server/**/*.ts', '../../../../shared/**/*.ts'],
  { query: '?raw', import: 'default', eager: true },
)

describe('the safeguarding binding', () => {
  it('is named only in server/safeguarding/', () => {
    const naming = Object.entries(sources)
      .filter(([, text]) => text.includes(NAME))
      .map(([path]) => path.replace(/^(\.\.\/)+/, ''))
    expect(naming.length).toBeGreaterThan(0)
    expect(naming.filter((path) => !path.startsWith('server/safeguarding/'))).toEqual([])
  })

  it('is read in one place only', () => {
    const naming = Object.entries(sources).filter(([, text]) => text.includes(NAME))
    expect(naming.map(([path]) => path.replace(/^(\.\.\/)+/, ''))).toEqual([
      'server/safeguarding/store.ts',
    ])
  })
})
