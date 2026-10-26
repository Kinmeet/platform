-- Interim safeguarding store (#36). A separate D1 database, bound as
-- SAFEGUARDING_DB, under the founder's decision of 26 October 2026: a
-- recorded, temporary exception to SG6 and P5 until the encrypted concern
-- record (S4, M2c) exists. Ezra's and Nadia's conditions on #36 apply.
--
-- Holds only what was handed over: the submission as it was sent, which form
-- it came from, when it was received and when it was handed over. No notes,
-- write-ups or case details.
--
-- There is no deletion date and no automatic deletion: retention of
-- safeguarding records is set by area 2. Triggers refuse every UPDATE and
-- DELETE. The store is emptied and the database deleted only at the M2c
-- sunset, by a reviewed one-off migration.
CREATE TABLE handed_over_items (
  -- The id of the row in hello_messages or applications, so a retried
  -- hand-over finds the copy it already made.
  id TEXT PRIMARY KEY NOT NULL,
  source_form TEXT NOT NULL CHECK (source_form IN ('hello', 'apply')),
  content TEXT NOT NULL CHECK (json_valid(content) AND json_type(content) = 'object'),
  received_at INTEGER NOT NULL,
  handed_over_at INTEGER NOT NULL CHECK (handed_over_at >= received_at)
) STRICT;

CREATE TRIGGER handed_over_items_no_update BEFORE UPDATE ON handed_over_items
BEGIN
  SELECT RAISE(ABORT, 'handed_over_items_insert_only');
END;

CREATE TRIGGER handed_over_items_no_delete BEFORE DELETE ON handed_over_items
BEGIN
  SELECT RAISE(ABORT, 'handed_over_items_insert_only');
END;
