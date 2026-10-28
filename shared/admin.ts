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
