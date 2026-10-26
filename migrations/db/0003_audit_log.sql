-- Append-only audit log for admin actions (P4, P5; #32).
--
-- Holds who acted (the Cloudflare Access user id, an opaque `sub`, never an
-- email address or name), what they did and to which row, and when. It
-- never copies anything from the row itself. Opening a list is recorded as
-- a view with no target row, so the log never becomes a second index of the
-- data (Ezra, #51). Triggers refuse every UPDATE,
-- and every DELETE until the entry's `delete_after` has passed, so entries
-- cannot be changed or removed early through the app. Entries are kept for
-- 2 years (Phase 1 rule, pending a P3 row) and then removed by the deletion
-- job like every other personal-data row.

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK (
    action IN ('mark_replied', 'mark_outcome_told', 'view_hello_messages', 'view_applications')
  ),
  target_table TEXT NOT NULL CHECK (target_table IN ('hello_messages', 'applications')),
  target_id TEXT,
  delete_after INTEGER NOT NULL CHECK (delete_after > at),
  -- Each action names its own table, and only a list view has no target row.
  CHECK (
    (action IN ('mark_replied', 'view_hello_messages')) = (target_table = 'hello_messages')
  ),
  CHECK ((action IN ('view_hello_messages', 'view_applications')) = (target_id IS NULL))
) STRICT;

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
