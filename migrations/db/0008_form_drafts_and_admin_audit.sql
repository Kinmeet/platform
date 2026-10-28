-- The form builder's working copies and audit entries (ADR-0010 phase B, #160).
--
-- `form_drafts` holds at most one working copy per form: the purpose,
-- definition and text an admin is editing, before it is checked and
-- published as a new `form_versions` row. A draft may be incomplete or fail
-- the publish checks; publishing checks it in full and then deletes it. It
-- holds admin-written text only, never anything from a submission, and
-- records who last saved it by their Access user id (`sub`), never a name or
-- email.
--
-- The audit log gains the form builder's actions: creating a form,
-- publishing a version and opening or closing a form, each naming the form.
-- SQLite cannot change a CHECK in place, so the table is rebuilt as in 0005,
-- with every entry kept exactly as it was and its indexes and append-only
-- triggers made again.

CREATE TABLE form_drafts (
  form_id TEXT PRIMARY KEY NOT NULL REFERENCES forms (id),
  -- Checked against shared/privacy/purposes.ts on publish, as for a version.
  purpose TEXT NOT NULL CHECK (purpose GLOB '[a-z]*' AND purpose NOT GLOB '*[^a-z_]*'),
  definition TEXT NOT NULL CHECK (
    json_valid(definition) AND json_type(definition) = 'object' AND length(definition) <= 32768
  ),
  text TEXT NOT NULL CHECK (
    json_valid(text) AND json_type(text) = 'object' AND length(text) <= 65536
  ),
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 128)
) STRICT;

CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK (
    action IN (
      'mark_replied',
      'mark_outcome_told',
      'view_hello_messages',
      'view_applications',
      'view_form_submissions',
      'pass_to_safeguarding',
      'open_safeguarding_item',
      'create_form',
      'publish_form_version',
      'open_form',
      'close_form'
    )
  ),
  target_table TEXT NOT NULL CHECK (
    (action = 'mark_replied' AND target_table IN ('hello_messages', 'form_submissions'))
    OR (action = 'mark_outcome_told' AND target_table IN ('applications', 'form_submissions'))
    OR (action = 'view_hello_messages' AND target_table = 'hello_messages')
    OR (action = 'view_applications' AND target_table = 'applications')
    OR (
      action IN ('view_form_submissions', 'create_form', 'publish_form_version', 'open_form', 'close_form')
      AND target_table = 'forms'
    )
    OR (
      action IN ('pass_to_safeguarding', 'open_safeguarding_item')
      AND target_table = 'safeguarding_items'
    )
  ),
  target_id TEXT,
  delete_after INTEGER NOT NULL CHECK (delete_after > at),
  -- Only the old list views have no target; every other entry names its row or form.
  CHECK ((action IN ('view_hello_messages', 'view_applications')) = (target_id IS NULL))
) STRICT;

INSERT INTO audit_log_new (id, at, actor, action, target_table, target_id, delete_after)
SELECT id, at, actor, action, target_table, target_id, delete_after FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX audit_log_at ON audit_log (at);
CREATE INDEX audit_log_delete_after ON audit_log (delete_after);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log_append_only');
END;

CREATE TRIGGER audit_log_no_early_delete BEFORE DELETE ON audit_log
WHEN OLD.delete_after > unixepoch()
BEGIN
  SELECT RAISE(ABORT, 'audit_log_append_only');
END;
