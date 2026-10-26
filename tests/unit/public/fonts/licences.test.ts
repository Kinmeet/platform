import { describe, expect, it } from 'vitest'
import atkinsonPackage from '../../../../node_modules/@fontsource/atkinson-hyperlegible-next/LICENSE?raw'
import fredokaPackage from '../../../../node_modules/@fontsource-variable/fredoka/LICENSE?raw'
import atkinsonServed from '../../../../public/fonts/AtkinsonHyperlegibleNext-OFL.txt?raw'
import fredokaServed from '../../../../public/fonts/Fredoka-OFL.txt?raw'

// OFL condition 2: every copy of a font we serve must come with its copyright
// notice and licence (ADR-0007). The copies in public/fonts/ must match the
// packages we bundle, so a font upgrade that changes its licence fails here.
const fonts = [
  {
    name: 'Fredoka',
    served: fredokaServed,
    bundled: fredokaPackage,
    copyright: 'Copyright 2016 The Fredoka Project Authors',
  },
  {
    name: 'Atkinson Hyperlegible Next',
    served: atkinsonServed,
    bundled: atkinsonPackage,
    copyright: 'Copyright 2020-2024 The Atkinson Hyperlegible Next Project Authors',
  },
]

describe('font licences', () => {
  it.each(fonts)('$name is served with its own copyright line', ({ served, copyright }) => {
    expect(served.startsWith(copyright)).toBe(true)
  })

  it.each(fonts)('$name is under the SIL Open Font Licence 1.1', ({ served }) => {
    expect(served).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })

  it.each(fonts)('$name served copy matches the bundled package', ({ served, bundled }) => {
    expect(served).toBe(bundled)
  })
})
