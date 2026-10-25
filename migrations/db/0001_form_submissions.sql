-- Tables for the two Sprint 1 forms (say hello and stage 1 trustee
-- applications) and the email sending log, as agreed in docs/api/forms.md.
--
-- Privacy (P3): no IP address, user agent or Turnstile token is stored
-- anywhere. Every row gets a deletion date when it is stored, so a message we
-- never answer or an application that never reaches a decision is still
-- deleted by the deletion job (#31).
--
-- Times are INTEGER Unix-epoch seconds in UTC. Ids are random UUIDs, never
-- sequential numbers. `submission_id` is the client's idempotency key; it
-- lives on the row so it is deleted with the row and outlives nothing.

-- Say hello messages. Kept until 12 months after our last reply: set to 12
-- months after receipt on insert, then pushed on by each reply.
CREATE TABLE hello_messages (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  call_name TEXT NOT NULL CHECK (length(call_name) BETWEEN 1 AND 60),
  email TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),
  message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 2000),
  received_at INTEGER NOT NULL,
  replied_at INTEGER CHECK (replied_at IS NULL OR replied_at >= received_at),
  delete_after INTEGER NOT NULL CHECK (delete_after > received_at)
) STRICT;

CREATE INDEX hello_messages_delete_after ON hello_messages (delete_after);

-- Stage 1 applications for a role (Sprint 1: trustee only). No legal details
-- (P1). Of the step 1 checks, only the applicant's `connection_to_founders`
-- answer is stored: the other two can only ever be "yes" once accepted. The
-- two refused answers are never stored, so the CHECK lists only the accepted
-- ones as a backstop. There is no conflict flag column; the admin page works
-- that out when it reads the row.
--
-- Kept until 6 months after the outcome is told. On insert, `delete_after` is
-- the backstop of 6 months after the round closes; recording the outcome
-- moves it to 6 months after that date.
CREATE TABLE applications (
  id TEXT PRIMARY KEY NOT NULL,
  submission_id TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role GLOB '[a-z]*' AND role NOT GLOB '*[^a-z_]*'),
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

CREATE INDEX applications_delete_after ON applications (delete_after);

-- Email sending log (P3: 30 days). Never holds the address itself, only an
-- HMAC of it (keyed with a Worker secret, computed by the sender), the
-- template id and when it was sent. Written by the email sender (#33).
CREATE TABLE email_log (
  id TEXT PRIMARY KEY NOT NULL,
  to_hmac TEXT NOT NULL CHECK (length(to_hmac) = 64 AND to_hmac NOT GLOB '*[^0-9a-f]*'),
  template_id TEXT NOT NULL CHECK (template_id GLOB '[a-z]*' AND template_id NOT GLOB '*[^a-z_]*'),
  sent_at INTEGER NOT NULL,
  delete_after INTEGER NOT NULL CHECK (delete_after > sent_at)
) STRICT;

CREATE INDEX email_log_delete_after ON email_log (delete_after);
-- The sender's per-address receipt limit counts recent rows for one HMAC.
CREATE INDEX email_log_to_hmac_sent_at ON email_log (to_hmac, sent_at);
