-- Publishes version 2 of the trustee application (ADR-0010, #156, A2). Only
-- one piece of wording changes: the short name of "Why would you like to be
-- a trustee?", used in the error list and on Check and send, becomes "Why
-- you'd like to be a trustee". The old one, "Why", did not say which
-- question it meant (Robin, #158), and the publish checks now refuse a
-- one-word summary. The definition is copied unchanged, so nothing collected,
-- kept or shown to anyone else changes: a wording change alone needs no
-- second approval. Version 1 stays as it was; the rows sent on it keep
-- pointing at it.

INSERT INTO form_versions (form_id, version, purpose, definition, text, published_at, published_by)
SELECT form_id, 2, purpose, definition,
       json_set(text, '$."en-GB"."fields.why_trustee.summary"', 'Why you''d like to be a trustee'),
       1793232000, 'migration'
FROM form_versions
WHERE form_id = '2568c14e-88bd-44c0-b3e2-ca7655c72fc4' AND version = 1;

UPDATE forms SET current_version = 2
WHERE id = '2568c14e-88bd-44c0-b3e2-ca7655c72fc4' AND current_version = 1;
