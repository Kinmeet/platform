/**
 * The accessibility statement (#145), built from P11 Accessibility statement
 * in its own words. Its copy lives under `accessibility` in `i18n/locales/`.
 *
 * Like the privacy notice, it waits for the founder's M1 review: its route
 * answers 404 and isn't in `publicRoutes`, so the footer link stays hidden.
 * Publishing needs P11's gaps closed, or the unit tests fail:
 * - `lastReviewed`: the date P11 shows at the top, as YYYY-MM-DD;
 * - `address`: the role address people write to, once there is a domain;
 * - `accessibility.known.body`: P11's known problems, or that none are known.
 */
export const accessibilityPage: {
  path: string
  published: boolean
  lastReviewed: string | null
  address: string | null
} = {
  path: '/accessibility',
  published: false,
  lastReviewed: null,
  address: null,
}
