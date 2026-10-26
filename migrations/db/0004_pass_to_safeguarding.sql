-- "Pass to safeguarding" (#36, SG6, SG-03 section 4), as the encrypted
-- interim store the founder chose on #95 (26 October 2026).
--
-- `safeguarding_items` holds each handed-over message or application,
-- encrypted in the Worker with AES-256-GCM under the SAFEGUARDING_KEY
-- secret (server/safeguarding/). In clear it holds only the id, the key
-- version, the IV, the ciphertext and when it was handed over. Who sent it,
-- what they wrote, which form it came from and when it arrived are all
-- inside the ciphertext (Ezra, #95), so D1, Time Travel and backups never
-- hold them in clear.
--
-- No `delete_after`: retention is area 2's to set, and the deletion job
-- never touches this table. The table is dropped at the M2c sunset, after
-- every record has moved to browser-side encryption and been checked.
CREATE TABLE safeguarding_items (
  id TEXT PRIMARY KEY NOT NULL,
  key_version INTEGER NOT NULL CHECK (key_version BETWEEN 1 AND 999999),
  iv BLOB NOT NULL CHECK (length(iv) = 12),
  -- At least the 16-byte authentication tag.
  ciphertext BLOB NOT NULL CHECK (length(ciphertext) > 16),
  handed_over_at INTEGER NOT NULL
) STRICT;

-- Nothing is ever deleted through the app.
CREATE TRIGGER safeguarding_items_no_delete BEFORE DELETE ON safeguarding_items
BEGIN
  SELECT RAISE(ABORT, 'safeguarding_items_insert_only');
END;

-- The only change allowed is re-encrypting a record under a newer key, for
-- a key rotation (docs/runbooks/rotate-safeguarding-key.md).
CREATE TRIGGER safeguarding_items_no_update BEFORE UPDATE ON safeguarding_items
WHEN NEW.id IS NOT OLD.id
  OR NEW.handed_over_at IS NOT OLD.handed_over_at
  OR NEW.key_version <= OLD.key_version
BEGIN
  SELECT RAISE(ABORT, 'safeguarding_items_insert_only');
END;

-- The audit log gains the hand-over and the acting lead opening an item
-- (#93). Both name the item only by its id; the form it came from is not
-- recorded. SQLite cannot change a CHECK in place, so the table is rebuilt
-- with every entry kept, and its indexes and append-only triggers are made
-- again exactly as in 0003.
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
      'pass_to_safeguarding',
      'open_safeguarding_item'
    )
  ),
  target_table TEXT NOT NULL CHECK (
    target_table = CASE
      WHEN action IN ('mark_replied', 'view_hello_messages') THEN 'hello_messages'
      WHEN action IN ('mark_outcome_told', 'view_applications') THEN 'applications'
      ELSE 'safeguarding_items'
    END
  ),
  target_id TEXT,
  delete_after INTEGER NOT NULL CHECK (delete_after > at),
  -- Only a list view has no target row.
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
