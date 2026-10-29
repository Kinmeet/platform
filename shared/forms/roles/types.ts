/**
 * Shape of a role's config (issue #19).
 *
 * The config holds ids only. Every word a visitor reads lives in
 * `i18n/locales/` under `roles.<slug>.…`, keyed by these ids, so the site can
 * be translated. A role's application form, its questions and their wording,
 * is a stored form with the role's slug (ADR-0010), not part of this config.
 *
 * No zod here on purpose: the config is plain data that the browser bundle
 * and the server both read.
 */

export interface RoleTag {
  id: string
  /** `paid` tags are filled wilder-green so paid roles stand out. */
  style: 'info' | 'paid'
}

/** Ids of the parts of a role page; each has wording under `roles.<slug>.page`. */
export interface RolePage {
  /** Sections, in order: `page.sections.<id>.heading` and `.body`. */
  sections: readonly string[]
  /** "At a glance" rows, in order: `page.glance.<id>.label` and `.value`. */
  glance: readonly string[]
  /** "What happens after you apply", in order: `page.next.<id>.title` and `.body`. */
  next: readonly string[]
}

interface RoleBase {
  /** URL slug, in kebab-case: `/roles/<slug>`. */
  slug: string
  tags: readonly RoleTag[]
}

/** A role that is open: it has a page, and its application form is stored. */
export interface PublishedRole extends RoleBase {
  published: true
  page: RolePage
}

/**
 * A role listed on the home page but not open yet. It needs only a title,
 * summary and tags; its page and questions are added when its content is
 * agreed (Q3).
 */
export interface DraftRole extends RoleBase {
  published: false
}

export type RoleConfig = PublishedRole | DraftRole
