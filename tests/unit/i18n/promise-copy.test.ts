import { describe, expect, it } from 'vitest'
import messages from '../../../i18n/locales/en-GB.json'
import { promisePage, type PromiseBlock } from '../../../shared/pages/promise'

// The all-ages promise (#77) is built before its words exist. Its keys stay
// empty until the safeguarding work agrees the copy, so nothing made up
// reaches the page, and it can't be published with any key still empty.
const copy = messages.promise
const sections = copy.sections as Record<string, { heading: string; blocks: PromiseBlock[] }>

const texts: [string, string][] = [
  ['page_title', copy.page_title],
  ['title', copy.title],
  ['lede', copy.lede],
  ...promisePage.sections.map((id): [string, string] => [
    `sections.${id}.heading`,
    sections[id]!.heading,
  ]),
]

describe('all-ages promise copy', () => {
  it('has a key for every section, and no others', () => {
    expect(Object.keys(sections)).toEqual([...promisePage.sections])
  })

  // Empty while it's a draft; filled in, every one, once it's published.
  it.each(texts)(`${promisePage.published ? 'fills in' : 'leaves empty'} %s`, (_key, text) => {
    expect(text.trim() !== '').toBe(promisePage.published)
  })

  it.each([...promisePage.sections])(
    `${promisePage.published ? 'gives' : 'holds back'} the %s section's paragraphs and lists`,
    (id) => {
      const blocks = sections[id]!.blocks
      expect(blocks.length > 0).toBe(promisePage.published)
      for (const block of blocks) {
        const lines = 'text' in block ? [block.text] : block.items
        expect(lines.length).toBeGreaterThan(0)
        for (const line of lines) expect(line.trim()).not.toBe('')
      }
    },
  )
})
