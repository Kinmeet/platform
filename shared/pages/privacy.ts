/**
 * The privacy notice (#144), built from P9 Website privacy notice in its own
 * words, with retention from P3. Its copy lives under `privacy` in
 * `i18n/locales/`.
 *
 * It stays unpublished until the founder's M1 review (Rowan, #144): its route
 * answers 404 and isn't in `publicRoutes`, so the footer and say hello links
 * stay hidden. Publishing needs every gap below closed, or the unit tests fail:
 * - `lastUpdated`: the date P9 shows at the top, as YYYY-MM-DD;
 * - `address`: the role address people write to, once there is a domain;
 * - no keys left under `privacy.draft`, which hold P9 edits proposed by the
 *   Privacy and Safeguarding Reviewer and not yet agreed. Each one moves into
 *   the notice's own keys, or is removed, at the review.
 */
export const privacyPage: {
  path: string
  published: boolean
  lastUpdated: string | null
  address: string | null
} = {
  path: '/how-we-handle-data',
  published: false,
  lastUpdated: null,
  address: null,
}
