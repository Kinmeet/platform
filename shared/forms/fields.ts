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

/**
 * Email address: at most 254 characters, basic syntax check only. Anything
 * stricter turns away real addresses; a reply that bounces is the real test.
 */
export const email = z
  .string()
  .trim()
  .min(1)
  .refine((value) => codePointLength(value) <= 254, { params: { code: 'too_long' }, abort: true })
  .refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
    params: { code: 'invalid_email' },
  })

/** Random id the page creates once per form, kept across retries (idempotency). */
export const submissionId = z.uuid({ version: 'v4' })

/** Single-use Turnstile token; verified on the server, never stored (S5, P3). */
export const turnstileToken = z.string().min(1).max(2048)
