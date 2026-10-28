-- Copies every existing say hello message and application into
-- `form_submissions` (ADR-0010 phase A, #156), keeping `id`,
-- `submission_id`, `received_at`, `replied_at`, `outcome_told_at` and
-- `delete_after` exactly as they are, so nobody's data is kept a day longer
-- and the ids that `safeguarding_items` and `audit_log` hold still match.
--
-- Say hello becomes { "message": ... } on version 1. An application keeps
-- its `connection_to_founders` answer and its step 3 answers, flat, on the
-- current version of the form for its role. Nothing is deleted or dropped:
-- the old tables keep their rows, and their deletion dates, until phase C.
-- A row that is already there is left alone, so this can safely run again.

INSERT INTO form_submissions (
  id, submission_id, form_id, version, call_name, email, answers,
  received_at, replied_at, delete_after
)
SELECT h.id, h.submission_id, f.id, f.current_version, h.call_name, h.email,
       json_object('message', h.message), h.received_at, h.replied_at, h.delete_after
FROM hello_messages AS h
JOIN forms AS f ON f.slug = 'hello' AND f.current_version IS NOT NULL
WHERE true
ON CONFLICT DO NOTHING;

INSERT INTO form_submissions (
  id, submission_id, form_id, version, call_name, email, answers,
  received_at, outcome_told_at, delete_after
)
SELECT a.id, a.submission_id, f.id, f.current_version, a.call_name, a.email,
       json_patch(json_object('connection_to_founders', a.connection_to_founders), a.answers),
       a.received_at, a.outcome_told_at, a.delete_after
FROM applications AS a
JOIN forms AS f ON f.slug = a.role AND f.kind = 'application' AND f.current_version IS NOT NULL
WHERE true
ON CONFLICT DO NOTHING;
