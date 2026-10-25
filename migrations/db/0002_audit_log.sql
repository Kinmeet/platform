-- Append-only audit log for admin actions (P4, P5; #32).
--
-- Holds who acted (the Cloudflare Access user id, an opaque `sub`, never an
-- email address or name), what they did and to which row, and when. It
-- never copies anything from the row itself. Triggers refuse every UPDATE
-- and DELETE, so entries cannot be changed or removed through the app.

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  action TEXT NOT NULL CHECK (action IN ('mark_replied', 'mark_outcome_told')),
  target_table TEXT NOT NULL CHECK (target_table IN ('hello_messages', 'applications')),
  target_id TEXT NOT NULL
) STRICT;

CREATE INDEX audit_log_at ON audit_log (at);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log_append_only');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log_append_only');
END;
