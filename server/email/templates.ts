import enGB from '../../i18n/locales/en-GB.json'

/**
 * Every email the platform can send. Templates are fixed: they take no text
 * from the request, so a form can never be used to send words of a
 * stranger's choosing to someone else's inbox.
 */
export const emailTemplateIds = ['application_receipt'] as const
export type EmailTemplateId = (typeof emailTemplateIds)[number]

export const emailLocales = ['en-GB'] as const
export type EmailLocale = (typeof emailLocales)[number]

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

type Messages = typeof enGB.email
const messages: Record<EmailLocale, Messages> = { 'en-GB': enGB.email }

const htmlEscapes: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => htmlEscapes[char] ?? char)
}

interface Body {
  subject: string
  paragraphs: string[]
  signOff: string
}

function bodyFor(template: EmailTemplateId, copy: Messages): Body {
  switch (template) {
    case 'application_receipt': {
      const receipt = copy.applicationReceipt
      return {
        subject: receipt.subject,
        paragraphs: [receipt.received, receipt.next, receipt.notYou],
        signOff: receipt.signOff,
      }
    }
  }
}

// Every email opens with a plain greeting and never addresses anyone by the
// name they typed, which could be any text at all (Security Reviewer).
function toText(body: Body, greeting: string, footer: string): string {
  return [
    greeting,
    '',
    ...body.paragraphs.flatMap((p) => [p, '']),
    body.signOff,
    '',
    '--',
    footer,
    '',
  ].join('\n')
}

// Plain HTML with no images, remote styles, fonts or links: nothing in the
// message can report back when it is opened (no tracking, rule 1).
function toHtml(body: Body, greeting: string, footer: string, locale: EmailLocale): string {
  const paragraphs = body.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('\n')
  return `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(body.subject)}</title>
</head>
<body style="margin:0;padding:24px;font-family:sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;background:#ffffff">
<p>${escapeHtml(greeting)}</p>
${paragraphs}
<p>${escapeHtml(body.signOff)}</p>
<hr style="border:0;border-top:1px solid #cccccc;margin:24px 0">
<p style="font-size:14px;color:#555555">${escapeHtml(footer)}</p>
</body>
</html>
`
}

export function renderEmail(template: EmailTemplateId, locale: EmailLocale): RenderedEmail {
  const copy = messages[locale]
  const body = bodyFor(template, copy)
  return {
    subject: body.subject,
    text: toText(body, copy.greeting, copy.footer),
    html: toHtml(body, copy.greeting, copy.footer, locale),
  }
}
