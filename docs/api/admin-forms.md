# Admin forms API (ADR-0010 phase B, #160)

The routes the form builder pages (B3) call. Every route is under `/api/admin`, so Cloudflare Access and the Worker's own check ([admin page](../admin.md#access)) stand in front of each one: a missing or bad Access token gets `403`, and so does any change (`POST`, `PUT`) that doesn't come from this environment's own origin. The actor recorded anywhere below is the Access user id (`sub`), never a name or email.

While the founder holds every role, the Access check is the role check (P4). A role check against the form's P4 readers comes with roles (M2).

Every reply is JSON with `ok`. A refusal carries `error`, one of the codes below. Bodies must be `application/json` objects; anything else gets `400 bad_request`. Bodies over the route's limit are refused at the Worker entry and again by the route (`shared/routes.ts`): 64 KB for most, 256 KB for a draft.

## Building a form

| Route                                | Does                                                                                                                                                                                                       | Refusals                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/forms`               | Lists every form: id, slug, kind, status, current version, P3 row, retention, readers, en-GB title, and whether it has a draft                                                                             |                                                                                                                                                                                   |
| `POST /api/admin/forms`              | Creates a form as a draft with no version, from `{ slug, kind }`. Writes a `create_form` audit entry. `201`                                                                                                | `409 slug_taken`; `422 slug_invalid`, `slug_reserved`, `kind_invalid`                                                                                                             |
| `GET /api/admin/forms/<id>`          | The form, its current version's content (`purpose`, `definition`, `text`), its draft if any, and its version history                                                                                       | `404 not_found`                                                                                                                                                                   |
| `PUT /api/admin/forms/<id>/draft`    | Saves the draft `{ purpose, definition, text }`, replacing any draft. Replies with the publish checks. Not audited: the draft records who saved it last, and nothing reaches the public until it publishes | `404 not_found`; `422 draft_invalid` (wrong shape or over a size limit)                                                                                                           |
| `GET /api/admin/forms/<id>/check`    | The publish checks on the draft, and a `preview`: exactly what the form's page would be given, or `null` while the draft can't be shown                                                                    | `404 not_found` (no form or no draft)                                                                                                                                             |
| `POST /api/admin/forms/<id>/publish` | Publishes the draft as the next version, moves the form to it and deletes the draft it published (a draft saved meanwhile stays), in one batch with a `publish_form_version` audit entry                   | `403 reauth_required`, `publishing_off` ([below](#the-publish-re-check)); `404 not_found`, `no_draft`; `409 changed` (someone published first); `422 checks_failed`, with `check` |
| `POST /api/admin/forms/<id>/status`  | Opens or closes a form, from `{ status: "open" \| "closed" }`. Writes `open_form` or `close_form`, only when the status changes                                                                            | `404 not_found`; `422 status_invalid`, `no_version`                                                                                                                               |

### The publish re-check

Until passkeys exist, publishing needs a fresh sign-in with MFA (Nadia's conditions on #160, recorded in ADR-0010):

- A separate Access application covers the publish page, `/admin/forms/<id>/publish`, and `POST /api/admin/forms/<id>/publish`. Its session is 5 minutes or less, and it asks for a security key or biometric on every sign-in.
- The Worker checks it as well as Access. On those two paths, the token must carry the publish application's audience (`ACCESS_PUBLISH_AUD`), have been issued in the last 5 minutes, and be valid for at most 10. A main admin token, or a stale publish one, gets `403 reauth_required`: the page links to itself, and reloading it makes Access ask for MFA again. A publish token is refused on every other admin route.
- The publish route also checks that the middleware ran the re-check, so a path the pattern missed can never publish on a main admin token.
- Where `ACCESS_PUBLISH_AUD` isn't set, every publish request gets `403 publishing_off`. It isn't set anywhere until the founder has set up the application (#133) and the staging test shows the MFA prompt firing.
- The page is a top-level navigation, never a background `fetch`, because Access answers an expired session with a redirect.

### Publish checks

`check` is `{ ok, problems, needsSecondApproval }` from `checkPublish` (`shared/forms/publish.ts`), the same checks the stored version is held to when it is read. `problems` names each problem by code and, where there is one, the text key or field.

A second approval is needed (Ezra, #160) for:

- a new form, or a change of purpose, readers or steps;
- any change to text that tells the person what to put in an answer: a label, hint, summary or choice, including one added or removed, in any locale;
- any version whose text, in any locale, names a sensitive term, whatever changed: health, disability, sex life, gender, race, beliefs, political views, trade union membership, genetic or biometric data, offences and police contact, DBS, and details we never collect such as date of birth, home address, postcode, passwords, PINs and bank or card details. The full list is `SENSITIVE_TERMS` in `shared/forms/publish.ts`.

The title, intro, step headings and notes are wording only. In Phase 1 there is no second person, so `second_approval_needed` is a problem and the version can't publish.

## Submissions

| Route                                           | Does                                                                                                                                                               | Refusals                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- |
| `GET /api/admin/forms/<id>/submissions`         | Writes a `view_form_submissions` entry for the form, then lists its submissions: answers in field order, labelled with the wording of the version each was sent on | `404 not_found`                    |
| `POST /api/admin/submissions/<id>/replied`      | Records a reply and moves the deletion date on, for a version whose purpose has that action                                                                        | `404 not_found`                    |
| `POST /api/admin/submissions/<id>/outcome-told` | Records that the outcome was told and moves the deletion date on, for a version whose purpose has that action                                                      | `404 not_found`                    |
| `POST /api/admin/submissions/<id>/safeguarding` | Passes the submission to the interim safeguarding store and removes it from the list. Only say hello and applications for now; any other form answers `404`        | `404 not_found`; `503 unavailable` |

The two recording actions count once: a second call answers `404`. Every answer is attacker-controlled text and is shown only as plain text ([forms API](forms.md#for-the-admin-page-later-tickets)).
