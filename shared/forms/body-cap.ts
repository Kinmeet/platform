/**
 * The largest body cap a published version may have. A fixed constant, so
 * the Worker's entry limit for form routes (ADR-0008) never depends on what
 * an admin publishes; publishing refuses any version over it. Kept in its own
 * file with no imports, so the Worker entry's route limits don't pull the
 * form schema library into its bundle (Nadia, #162).
 */
export const FORM_BODY_CAP_MAX = 64 * 1024
