/**
 * The all-ages promise page (#77): a plain-English summary of SG-01, SG-05
 * and SG-06, written by the safeguarding work once SG-01 is adopted.
 *
 * Until then the page is built but not published: its route answers 404 and
 * isn't in `publicRoutes`, so the home page's "Read the promise" button and
 * the footer link stay hidden (#68, #18). Its copy lives under `promise` in
 * `i18n/locales/`, with every key empty until the words are agreed. Turning
 * `published` on needs every key filled in, or the unit tests fail.
 */
export const promisePage = {
  path: '/all-ages-promise',
  published: false,
  /** Sections in page order: SG-01 (the policy), SG-05 (ages), SG-06 (adults). */
  sections: ['policy', 'ages', 'adults'],
} as const

export type PromiseSection = (typeof promisePage.sections)[number]

/**
 * One block of a section's copy, in `promise.sections.<id>.blocks`: a
 * paragraph, or a list such as the age rules or what adults never do (Robin,
 * #140). Each text is a whole sentence, so the copy sets the order and shape
 * without a change to the page.
 */
export type PromiseBlock = { text: string } | { items: string[] }
