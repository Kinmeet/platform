/**
 * Shape of a role's config (issue #19, docs/api/forms.md).
 *
 * The config holds ids, choices and rules only. Every word a visitor reads
 * lives in `i18n/locales/` under `roles.<slug>.…`, keyed by these ids, so the
 * site can be translated and the admin page can label answers. Ids are part
 * of the forms contract: Services validates against them, so changing one is
 * a contract change reviewed by both squads.
 *
 * No zod here on purpose: the config is plain data that the browser bundle,
 * the server's schema and the admin page all read.
 *
 * Wording keys for every question, under `roles.<slug>.questions.<id>`:
 * - `label`: the question (a fieldset legend, or a field or checkbox label)
 * - `hint`: optional help under the label
 * - `summary`: the short label on "Check and send" and the admin page
 * - `choices.<choiceId>`: each choice; for a confirm question, `choices.yes`
 *   is what "Check and send" shows once it is ticked
 * - `notes.<choiceId>`: shown after a choice whose outcome is `{ note: true }`
 * - `link`: link text, for a confirm question with a `link`
 */

/** Why a step 1 answer ends the application. Matches the API error codes. */
export type StopReason = 'under_18' | 'not_independent'

/** What happens after a step 1 choice. Choices not listed simply continue. */
export type ChoiceOutcome =
  /** The flow ends on the page for this reason. */
  | { stop: StopReason }
  /** The flow continues and shows `questions.<id>.notes.<choiceId>`. */
  | { note: true }

/** One answer from a fixed list, shown as large radio boxes. */
export interface SingleChoiceQuestion {
  id: string
  type: 'single_choice'
  required: true
  choices: readonly string[]
  outcomes?: Readonly<Record<string, ChoiceOutcome>>
}

/** A statement the visitor must tick. Its only choice is `yes`. */
export interface ConfirmQuestion {
  id: string
  type: 'confirm'
  required: true
  choices: readonly ['yes']
  /** An outside page to read before ticking; its link text is `questions.<id>.link`. */
  link?: string
}

/** Free text in a text area. */
export interface LongTextQuestion {
  id: string
  type: 'long_text'
  required: boolean
  /** Most Unicode code points the answer may have. */
  maxLength: number
}

/** Step 1 checks are always answered from a list or a tick. */
export type CheckQuestion = SingleChoiceQuestion | ConfirmQuestion

/** Step 3 role questions. More types arrive with the artist roles. */
export type RoleQuestion = LongTextQuestion

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

export interface RoleApply {
  /** Step 1, "Check it fits". */
  checks: readonly CheckQuestion[]
  /** Step 3, "About the role". */
  questions: readonly RoleQuestion[]
  /** A note at the foot of step 1, `apply.note.heading` and `.body`, such as the DBS check. */
  note: boolean
}

interface RoleBase {
  /** URL slug, in kebab-case: `/roles/<slug>`. */
  slug: string
  tags: readonly RoleTag[]
}

/** A role that is open: it has a page and an application form. */
export interface PublishedRole extends RoleBase {
  published: true
  page: RolePage
  apply: RoleApply
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
