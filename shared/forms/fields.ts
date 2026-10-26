/**
 * Field rules shared by the forms and their API (docs/api/forms.md), so the
 * page and the server count and check text the same way.
 */

export const CALL_NAME_MAX = 60
export const EMAIL_MAX = 254

/** Length in Unicode code points, as the contract counts it. */
export function codePointLength(text: string): number {
  return [...text].length
}

// Any C0 or C1 control character, including CR and LF.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/**
 * The contract's basic email check: something before an @, a domain with a
 * dot after it, no spaces and no control characters (so it can never inject
 * a mail header). Whether it really exists is for the reply to find out.
 */
export function isPlausibleEmail(email: string): boolean {
  if (CONTROL.test(email) || /\s/.test(email)) return false
  return /^[^@]+@[^@.]+(\.[^@.]+)+$/.test(email)
}
