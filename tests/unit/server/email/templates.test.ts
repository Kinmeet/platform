import { describe, expect, it } from 'vitest'
import enGB from '../../../../i18n/locales/en-GB.json'
import { emailTemplateIds, escapeHtml, renderEmail } from '../../../../server/email/templates'

describe('email templates', () => {
  const receipt = renderEmail('application_receipt', 'en-GB')

  it('takes all of its text from the translation file', () => {
    const copy = enGB.email.applicationReceipt
    expect(receipt.subject).toBe(copy.subject)
    for (const line of [
      enGB.email.greeting,
      copy.received,
      copy.next,
      copy.notYou,
      copy.signOff,
      enGB.email.footer,
    ]) {
      expect(receipt.text).toContain(line)
      expect(receipt.html).toContain(escapeHtml(line))
    }
  })

  it('loads nothing remote and has no links, images or scripts', () => {
    for (const template of emailTemplateIds) {
      const { html, text } = renderEmail(template, 'en-GB')
      expect(html).not.toMatch(/https?:\/\//i)
      expect(html).not.toMatch(/<(a|img|script|link|iframe|object|form)\b/i)
      expect(html).not.toMatch(/url\(/i)
      expect(text).not.toMatch(/https?:\/\//i)
    }
  })

  it('opens with a plain greeting', () => {
    expect(receipt.text.startsWith('Hello,\n')).toBe(true)
    expect(receipt.html).toContain('<body')
    expect(receipt.html.split('<body')[1]).toMatch(/^[^>]*>\s*<p>Hello,<\/p>/)
  })

  it('sets the language on the HTML part', () => {
    expect(receipt.html).toContain('<html lang="en-GB">')
  })

  it('escapes HTML special characters', () => {
    expect(escapeHtml(`<b>"Fern" & 'Fox'</b>`)).toBe(
      '&lt;b&gt;&quot;Fern&quot; &amp; &#39;Fox&#39;&lt;/b&gt;',
    )
  })
})
