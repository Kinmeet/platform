import { describe, expect, it } from 'vitest'
import messages from '../../../i18n/locales/en-GB.json'
import { promisePage } from '../../../shared/pages/promise'

// The all-ages promise (#77) is built before its words exist. Its keys stay
// empty until the safeguarding work agrees the copy, so nothing made up
// reaches the page, and it can't be published with any key still empty.
const copy = messages.promise
const keys: [string, string][] = [
  ['page_title', copy.page_title],
  ['title', copy.title],
  ['lede', copy.lede],
  ...promisePage.sections.flatMap((id): [string, string][] => [
    [`sections.${id}.heading`, copy.sections[id].heading],
    [`sections.${id}.body`, copy.sections[id].body],
  ]),
]

describe('all-ages promise copy', () => {
  it('has a key for every section, and no others', () => {
    expect(Object.keys(copy.sections)).toEqual([...promisePage.sections])
  })

  // Empty while it's a draft; filled in, every one, once it's published.
  it.each(keys)(`${promisePage.published ? 'fills in' : 'leaves empty'} %s`, (_key, text) => {
    expect(text.trim() !== '').toBe(promisePage.published)
  })
})
