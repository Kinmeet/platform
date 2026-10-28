-- The forms engine (ADR-0010 phase A, #156): forms defined as data, each
-- published version kept unchanged, and one table for every submission.
--
-- `forms` has one row per form. `form_versions` holds each published
-- version: its definition (the steps and fields, bounded by
-- shared/forms/definition.ts), its text per locale, and the P3 purpose it
-- collects for (shared/privacy/purposes.ts), which sets its lawful basis,
-- retention and widest readers. A published version never changes: editing
-- makes a new version. Every submission keeps the version it was sent on, so
-- its answers keep their labels and the rules that applied.
--
-- Say hello and the trustee application are seeded as version 1, from the
-- config and copy they had in code (#48, #80). The roles that are listed but
-- not open yet are seeded as drafts with no version, so an application for
-- one is still `role_closed`. 0006 copies the existing rows in.
--
-- `hello_messages` and `applications` stay until phase C. Until then a
-- trigger copies any row written to them into `form_submissions`, so a row
-- stored by the old code during a deploy is never left behind.

CREATE TABLE forms (
  id TEXT PRIMARY KEY NOT NULL,
  -- A URL part and the Turnstile action: unique whatever the letter case.
  slug TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (
    length(slug) BETWEEN 1 AND 32 AND slug NOT GLOB '*[^a-z0-9-]*'
  ),
  kind TEXT NOT NULL CHECK (kind IN ('form', 'application')),
  status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'closed')),
  -- NULL until the first version is published.
  current_version INTEGER,
  created_at INTEGER NOT NULL,
  CHECK (status = 'draft' OR current_version IS NOT NULL),
  FOREIGN KEY (id, current_version) REFERENCES form_versions (form_id, version)
) STRICT;

CREATE TABLE form_versions (
  form_id TEXT NOT NULL REFERENCES forms (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  -- A key of shared/privacy/purposes.ts; the code refuses any other.
  purpose TEXT NOT NULL CHECK (purpose GLOB '[a-z]*' AND purpose NOT GLOB '*[^a-z_]*'),
  definition TEXT NOT NULL CHECK (
    json_valid(definition) AND json_type(definition) = 'object' AND length(definition) <= 32768
  ),
  -- Admin-written text per locale: { "en-GB": { key: text } }. Always shown as text.
  text TEXT NOT NULL CHECK (
    json_valid(text) AND json_type(text) = 'object' AND length(text) <= 65536
  ),
  published_at INTEGER NOT NULL,
  -- The Cloudflare Access user id (`sub`), never a name or email; `migration` for seeds.
  published_by TEXT NOT NULL CHECK (length(published_by) BETWEEN 1 AND 128),
  PRIMARY KEY (form_id, version)
) STRICT;

CREATE TRIGGER form_versions_no_update BEFORE UPDATE ON form_versions
BEGIN
  SELECT RAISE(ABORT, 'form_versions_published');
END;

CREATE TRIGGER form_versions_no_delete BEFORE DELETE ON form_versions
BEGIN
  SELECT RAISE(ABORT, 'form_versions_published');
END;

-- Every submission to every form. Only what P3 allows for the version's
-- purpose: no IP address, user agent or Turnstile token. `answers` is flat,
-- keyed by field id; ticks and choices with only one accepted answer are
-- not stored. Every row gets its deletion date when it is stored.
CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  form_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  call_name TEXT NOT NULL CHECK (length(call_name) BETWEEN 1 AND 60),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  answers TEXT NOT NULL CHECK (
    json_valid(answers) AND json_type(answers) = 'object' AND length(answers) <= 65536
  ),
  received_at INTEGER NOT NULL,
  replied_at INTEGER CHECK (replied_at IS NULL OR replied_at >= received_at),
  outcome_told_at INTEGER CHECK (outcome_told_at IS NULL OR outcome_told_at >= received_at),
  delete_after INTEGER NOT NULL CHECK (delete_after > received_at),
  FOREIGN KEY (form_id, version) REFERENCES form_versions (form_id, version)
) STRICT;

CREATE INDEX form_submissions_delete_after ON form_submissions (delete_after);
CREATE INDEX form_submissions_form_received ON form_submissions (form_id, received_at);

-- Version 1 of say hello and the trustee application.
INSERT INTO forms (id, slug, kind, status, current_version, created_at) VALUES
  ('16965810-dfdb-40b3-a137-a9cc2e79392b', 'hello', 'form', 'draft', NULL, 1793145600),
  ('2568c14e-88bd-44c0-b3e2-ca7655c72fc4', 'trustee', 'application', 'draft', NULL, 1793145600),
  ('28649eb2-a1cb-46b3-8919-a0e372e039e4', 'artist-mark', 'application', 'draft', NULL, 1793145600),
  ('789c35b9-c317-4f73-bbef-ce2664587beb', 'artist-illustration', 'application', 'draft', NULL, 1793145600),
  ('5a7e2f52-1201-40bb-a1d7-31cc57fd3109', 'safeguarding-lead', 'application', 'draft', NULL, 1793145600),
  ('c39e1704-c295-4a32-90dc-434fd825a152', 'treasurer', 'application', 'draft', NULL, 1793145600),
  ('24ba8652-fa90-43b7-ade6-2007a82c2074', 'pilot-group-lead', 'application', 'draft', NULL, 1793145600);

INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
VALUES
  ('16965810-dfdb-40b3-a137-a9cc2e79392b', 1, 'say_hello',
   '{"steps":[{"id":"message","body":null,"fields":[{"id":"message","type":"long_text","required":true,"maxLength":2000}]}],"aboutYou":0,"note":false,"receipt":"none","actions":["reply","pass_to_safeguarding"],"readers":["central_team","secretary"]}',
   '{"en-GB":{"title":"Say hello","intro":"Questions, ideas, or just curious? A real person reads every message and replies within a week.","fields.message.label":"Your message","fields.message.summary":"Your message"}}',
   1793145600, 'migration'),
  ('2568c14e-88bd-44c0-b3e2-ca7655c72fc4', 1, 'trustee_application',
   '{"steps":[{"id":"checks","body":"checks","fields":[{"id":"over_18","type":"single_choice","required":true,"choices":["yes","no"],"outcomes":{"no":{"stop":"under_18"}}},{"id":"connection_to_founders","type":"single_choice","required":true,"choices":["no","related_or_household","friend_or_acquaintance","not_sure"],"outcomes":{"related_or_household":{"stop":"not_independent"},"friend_or_acquaintance":{"note":true},"not_sure":{"note":true}}},{"id":"trustee_rules_confirmed","type":"confirm","required":true,"link":"https://www.gov.uk/guidance/automatic-disqualification-rules-for-charity-trustees-and-charity-senior-positions"}]},{"id":"answers","body":"answers","fields":[{"id":"why_trustee","type":"long_text","required":true,"maxLength":2000},{"id":"experience","type":"long_text","required":false,"maxLength":2000}]}],"aboutYou":1,"note":true,"receipt":"application_receipt","actions":["outcome_told","pass_to_safeguarding"],"readers":["secretary","safeguarding_lead","chair"]}',
   '{"en-GB":{"title":"Trustee","note.heading":"About the DBS check","note.body":"This role needs a basic DBS check, which we arrange and pay for. If our checking body confirms the role is eligible for an enhanced check, we''ll arrange that instead. Something on your record doesn''t automatically rule you out; we''d talk it through in confidence. We never keep a copy of the certificate, only that we saw it, the date and the outcome.","fields.over_18.label":"Are you 18 or over?","fields.over_18.summary":"18 or over","fields.over_18.choices.yes":"Yes","fields.over_18.choices.no":"No","fields.connection_to_founders.label":"Are you connected to anyone already on the founding team?","fields.connection_to_founders.hint":"Trustees, including the treasurer and safeguarding lead, need to be independent of each other. Roles that aren''t trustee roles, like the artists and pilot group leads, don''t have this rule.","fields.connection_to_founders.summary":"Connected to the founding team","fields.connection_to_founders.choices.no":"No","fields.connection_to_founders.choices.related_or_household":"Yes: we''re related, in a relationship, or live together","fields.connection_to_founders.choices.friend_or_acquaintance":"Yes: we''re friends, or know each other","fields.connection_to_founders.choices.not_sure":"Not sure","fields.connection_to_founders.notes.friend_or_acquaintance":"That''s fine. Trustees who know each other say so to the rest of the board, and step out of any decision where it could matter.","fields.connection_to_founders.notes.not_sure":"That''s fine. Carry on, and we''ll talk it through when we chat.","fields.trustee_rules_confirmed.label":"I''ve read the Charity Commission''s rules on who can''t be a trustee, and as far as I know none apply to me.","fields.trustee_rules_confirmed.summary":"Trustee rules","fields.trustee_rules_confirmed.link":"Read the rules on GOV.UK (opens in a new tab)","fields.trustee_rules_confirmed.choices.yes":"Read, none apply","fields.why_trustee.label":"Why would you like to be a trustee?","fields.why_trustee.hint":"A few sentences is plenty. There''s no right answer.","fields.why_trustee.summary":"Why","fields.experience.label":"Anything you''ve done that feels relevant? (optional)","fields.experience.hint":"Committees, clubs, looking after money, moderating a server. Nothing is fine too.","fields.experience.summary":"Relevant experience"}}',
   1793145600, 'migration');

UPDATE forms SET status = 'open', current_version = 1
WHERE id IN ('16965810-dfdb-40b3-a137-a9cc2e79392b', '2568c14e-88bd-44c0-b3e2-ca7655c72fc4');

-- Until phase C drops them, anything written to the old tables is copied in,
-- with the same id, dates and deletion date.
CREATE TRIGGER hello_messages_copy_to_form_submissions AFTER INSERT ON hello_messages
BEGIN
  INSERT INTO form_submissions (
    id, submission_id, form_id, version, call_name, email, answers,
    received_at, replied_at, delete_after
  )
  SELECT NEW.id, NEW.submission_id, forms.id, forms.current_version, NEW.call_name, NEW.email,
         json_object('message', NEW.message), NEW.received_at, NEW.replied_at, NEW.delete_after
  FROM forms WHERE forms.slug = 'hello' AND forms.current_version IS NOT NULL
  ON CONFLICT DO NOTHING;
END;

CREATE TRIGGER applications_copy_to_form_submissions AFTER INSERT ON applications
BEGIN
  INSERT INTO form_submissions (
    id, submission_id, form_id, version, call_name, email, answers,
    received_at, outcome_told_at, delete_after
  )
  SELECT NEW.id, NEW.submission_id, forms.id, forms.current_version, NEW.call_name, NEW.email,
         json_patch(json_object('connection_to_founders', NEW.connection_to_founders), NEW.answers),
         NEW.received_at, NEW.outcome_told_at, NEW.delete_after
  FROM forms
  WHERE forms.slug = NEW.role AND forms.kind = 'application' AND forms.current_version IS NOT NULL
  ON CONFLICT DO NOTHING;
END;

-- The audit log's CHECKs move to the generic names (ADR-0010). Actions on a
-- submission now name `form_submissions`, and a list view names the form it
-- showed. The old names stay valid, so every existing entry is kept exactly
-- as it was. SQLite cannot change a CHECK in place, so the table is rebuilt
-- as in 0004, with its indexes and append-only triggers made again.
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
      'open_safeguarding_item'
    )
  ),
  target_table TEXT NOT NULL CHECK (
    (action = 'mark_replied' AND target_table IN ('hello_messages', 'form_submissions'))
    OR (action = 'mark_outcome_told' AND target_table IN ('applications', 'form_submissions'))
    OR (action = 'view_hello_messages' AND target_table = 'hello_messages')
    OR (action = 'view_applications' AND target_table = 'applications')
    OR (action = 'view_form_submissions' AND target_table = 'forms')
    OR (
      action IN ('pass_to_safeguarding', 'open_safeguarding_item')
      AND target_table = 'safeguarding_items'
    )
  ),
  target_id TEXT,
  delete_after INTEGER NOT NULL CHECK (delete_after > at),
  -- Only the old list views have no target; a list view now names its form.
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
