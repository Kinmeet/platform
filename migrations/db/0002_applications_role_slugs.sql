-- Lets `applications.role` hold kebab-case role slugs (#66). The role config
-- (shared/forms/roles, #64) uses slugs such as `safeguarding-lead`, but 0001
-- only allowed lowercase letters and underscores, so the first application
-- for such a role would have been refused here after passing validation.
--
-- SQLite can't change a CHECK in place, so the table is rebuilt: create the
-- new table, copy every row, drop the old one and rename. Every other column,
-- constraint and index is exactly as in 0001.

CREATE TABLE applications_new (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role GLOB '[a-z]*' AND role NOT GLOB '*[^a-z_-]*'),
  connection_to_founders TEXT NOT NULL
    CHECK (connection_to_founders IN ('friend_or_acquaintance', 'no', 'not_sure')),
  call_name TEXT NOT NULL CHECK (length(call_name) BETWEEN 1 AND 60),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  -- Step 3 answers as a JSON object keyed by question id from the role config.
  answers TEXT NOT NULL CHECK (json_valid(answers) AND json_type(answers) = 'object'),
  received_at INTEGER NOT NULL,
  outcome_told_at INTEGER CHECK (outcome_told_at IS NULL OR outcome_told_at >= received_at),
  delete_after INTEGER NOT NULL CHECK (delete_after > received_at)
) STRICT;

INSERT INTO applications_new (
  id, submission_id, role, connection_to_founders, call_name, email, answers,
  received_at, outcome_told_at, delete_after
)
SELECT
  id, submission_id, role, connection_to_founders, call_name, email, answers,
  received_at, outcome_told_at, delete_after
FROM applications;

DROP TABLE applications;

ALTER TABLE applications_new RENAME TO applications;

CREATE INDEX applications_delete_after ON applications (delete_after);
