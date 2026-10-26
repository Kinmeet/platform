-- "Pass to safeguarding" (#36, SG6, SG-03 section 4): the audit log gains
-- the new action. The handed-over copy itself lives in the separate
-- safeguarding database (migrations/safeguarding), never here; the hand-over
-- deletes the row from hello_messages or applications.
--
-- SQLite cannot change a CHECK in place, so the table is rebuilt with every
-- entry kept, and its indexes and append-only triggers are made again exactly
-- as in 0003.
CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 128),
  action TEXT NOT NULL
    CHECK (action IN ('mark_replied', 'mark_outcome_told', 'pass_to_safeguarding')),
  target_table TEXT NOT NULL CHECK (target_table IN ('hello_messages', 'applications')),
  target_id TEXT NOT NULL,
  delete_after INTEGER NOT NULL CHECK (delete_after > at)
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
