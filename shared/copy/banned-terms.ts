/**
 * Words the handbook bans in user-facing text (firm rule 4), with what to
 * use instead. `bun run check:copy` runs them over the translation files,
 * and publishing a stored form runs them over its text (ADR-0010).
 */
export const bannedTerms: readonly { pattern: RegExp; use: string }[] = [
  { pattern: /\bn?sfw\b/i, use: '"all-ages"' },
  { pattern: /\bchapters?\b/i, use: '"local group" or "group"' },
  { pattern: /\bmoots?\b/i, use: '"meet"' },
]
