/** Shapes the admin API returns to the admin page (#32). Times are Unix-epoch seconds. */

export interface AdminHelloMessage {
  id: string
  callName: string
  email: string
  message: string
  receivedAt: number
  repliedAt: number | null
  deleteAfter: number
}

export interface AdminApplication {
  id: string
  role: string
  callName: string
  email: string
  answers: Record<string, string>
  /**
   * Each answer's question, as the version it was sent on labelled it, so a
   * later rewording never changes what an old answer appears to answer
   * (Theo, #159). Admin text: always shown as plain text.
   */
  labels: Record<string, string>
  /**
   * Worked out on read from the applicant's own answer (F3); never stored as
   * a flag, and never counted or summarised.
   */
  conflictToDeclare: boolean
  connectionToFounders: string
  receivedAt: number
  outcomeToldAt: number | null
  deleteAfter: number
}

/** One form on the form builder's list (#160). No submissions, only the form's settings. */
export interface AdminFormSummary {
  id: string
  slug: string
  kind: 'form' | 'application'
  status: 'draft' | 'open' | 'closed'
  /** The published version, or `null` if none has been published yet. */
  version: number | null
  /** The P3 row the current version collects for, as P3 names it. */
  p3Row: string | null
  /** How long submissions are kept, in months, after the purpose's starting event. */
  retentionMonths: number | null
  /** The P4 roles that may read submissions on the current version. */
  readers: string[]
  /** The current version's title (admin text, shown as plain text). */
  title: string | null
  hasDraft: boolean
}

/** A version or a draft, as stored: the definition and text are JSON objects. */
export interface AdminFormContent {
  purpose: string
  definition: unknown
  text: unknown
}

export interface AdminFormDetail {
  form: AdminFormSummary
  current: (AdminFormContent & { version: number; publishedAt: number }) | null
  draft: (AdminFormContent & { updatedAt: number }) | null
  /** Every published version, newest first. */
  versions: { version: number; publishedAt: number }[]
}

/** What publishing the draft would find (`checkPublish`), as codes and paths only. */
export interface AdminFormCheck {
  ok: boolean
  problems: { code: string; path: string }[]
  needsSecondApproval: boolean
}

/**
 * One submission on the generic submissions list (#160). Every label and
 * choice comes from the version it was sent on, so a later rewording never
 * changes what an old answer appears to answer. Admin text and sender text:
 * always shown as plain text.
 */
export interface AdminSubmission {
  id: string
  version: number
  callName: string
  email: string
  /** Each stored answer as it reads: a choice shows its wording, text as sent. */
  answers: { id: string; label: string; text: string }[]
  receivedAt: number
  repliedAt: number | null
  outcomeToldAt: number | null
  deleteAfter: number
  /** What may be done to it, from its version: reply, outcome told, pass to safeguarding. */
  actions: ('reply' | 'outcome_told' | 'pass_to_safeguarding')[]
}
