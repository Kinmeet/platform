import { z } from 'zod'

/**
 * Field schemas shared by every form (docs/api/forms.md).
 *
 * Schemas never set messages. A rule our own error codes need, but Zod does
 * not name, is a refinement carrying `params.code`, which
 * `shared/forms/errors.ts` turns into that code.
 */

/** Length in Unicode code points, the same in the browser and on the server. */
export function codePointLength(value: string): number {
  return [...value].length
}

/** Most code points a Turnstile token may have. */
export const TURNSTILE_TOKEN_MAX = 2048
/** Most code points an email address may have. */
export const EMAIL_MAX = 254
/** A UUID is always 36 characters. */
export const SUBMISSION_ID_LENGTH = 36

/**
 * Trimmed text of 1 to `max` code points. Empty after trimming counts as
 * missing (`required`); longer than `max` is `too_long`.
 */
export function text(max: number) {
  return z
    .string()
    .trim()
    .min(1)
    .refine((value) => codePointLength(value) <= max, { params: { code: 'too_long' }, abort: true })
}

/** The name someone wants to be called (never a legal name). */
export const callName = text(60)

// C0 and C1 control characters (CR and LF among them) and DEL.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u

/**
 * Email address: at most 254 characters, basic syntax check only. Anything
 * stricter turns away real addresses; a reply that bounces is the real test.
 * Any control character, even at either end before trimming, is refused, so
 * an address can never inject a mail header.
 */
export const email = z
  .string()
  .refine((value) => value.trim() === '' || !CONTROL_CHARACTERS.test(value), {
    params: { code: 'invalid_email' },
    abort: true,
  })
  .trim()
  .min(1)
  .refine((value) => codePointLength(value) <= EMAIL_MAX, {
    params: { code: 'too_long' },
    abort: true,
  })
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    params: { code: 'invalid_email' },
  })

/** Random id the page creates once per form, kept across retries (idempotency). */
export const submissionId = z.uuid({ version: 'v4' })

/** Single-use Turnstile token; verified on the server, never stored (S5, P3). */
export const turnstileToken = z.string().min(1).max(TURNSTILE_TOKEN_MAX)

/**
 * A form's body cap in bytes, from its schema's worst case
 * (docs/api/forms.md, "Body size cap"): the most code points of every field,
 * times 4 bytes for UTF-8, plus 4 KB for JSON overhead, rounded up to a
 * whole KB. Pass every field's maximum, so the cap grows with the form.
 * A hand-made client that writes non-ASCII as `\uXXXX` escapes (6 to 12 bytes
 * each) can pass the cap and get `400`; our pages use `JSON.stringify`, which
 * sends UTF-8 as it is, so real visitors are unaffected.
 */
export function bodyCapBytes(fieldMaxima: readonly number[]): number {
  const worstCase = fieldMaxima.reduce((sum, max) => sum + max, 0) * 4 + 4096
  return Math.ceil(worstCase / 1024) * 1024
}
