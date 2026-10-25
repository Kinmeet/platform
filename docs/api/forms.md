# Forms API: say hello and apply

Owner: Services squad (Sol Ferreira). Agreed with the Web squad (Callum Reid) on 25 October 2026. This file is the source of truth for the two Sprint 1 form endpoints; change it by pull request, with both squads reviewing.

Sources: P1 Phase 1, P3 data map and retention, S5 (Turnstile). Not collected: pronouns and rough location (F8), and no "email me when the first meet is announced" flag until area 5 decides.

## Shared rules for both endpoints

- **Same origin only.** JSON over `POST`, with no CORS headers. The server refuses with `400 bad_request` unless `Origin` matches our own origin, `Sec-Fetch-Site` is `same-origin` (when present) and `Content-Type` is `application/json`.
- **Body size cap.** Bodies over 16 KB are refused with `400 bad_request` before parsing.
- **Validation.** Zod 4 (Tech Lead, 25 October; ADR-0004). Each form has `shared/forms/<form>.ts`, which exports its schema and inferred type. Schemas never set messages; one helper, `shared/forms/errors.ts`, maps Zod issues to `{ field, code }`.
- **Shared schema.** One validation schema per form lives in `shared/forms/` and is imported by both the page (client checks) and the server route (the real check). The server never trusts the client check. Library is Theo's call (Zod or Valibot suggested).
- **Error codes, not sentences.** The server returns a field name and a stable code; the page turns the code into translated text. No user-facing English comes from the API (P1 Phase 4: Welsh later).
- **Idempotent retries.** The page generates a random `submissionId` (UUID v4) once: when the say hello form loads, or when the apply flow starts. It is kept across steps and retries, sent with every attempt, and cleared only after a successful send, so it is never regenerated per step. Turnstile tokens are single-use, so every retry carries a fresh token. The order is: verify Turnstile first, then look up `submissionId`. A repeat with the same id returns the first result and stores nothing new, even when the body differs, so nothing is overwritten. The id is stored on the row itself, so it is deleted with the row and nothing outlives the submission. This is what lets "send failed" keep the answers and offer Try again without creating duplicates.
- **What is never stored or logged:** IP address, user agent, request body in logs, Turnstile token after verification (P3, P9).
- **Turnstile** token in `turnstileToken`, verified server-side before anything is stored (S5). The siteverify call sends only the secret and the token, never the optional `remoteip`.
- **Rate limiting.** Uses Cloudflare's rate limiting binding with the key `${form}:${hmac(ip)}` (an HMAC with a Worker secret, never the raw IP, and the key is never logged). The per-IP limit is generous (about 5 per 60 seconds per form), because schools, colleges and mobile networks share addresses. A global per-form limiter acts as a flood backstop, and Turnstile stays the main defence. Counts live only inside Cloudflare, and we write nothing. `retryAfter` matches the limiter's period. Receipt emails are rate-limited too. Security sign-off: Nadia.
- **Logs:** the Workers observability settings for these routes keep no request headers (`CF-Connecting-IP`, `User-Agent`) and no bodies, and errors log a code, never the request body. Jun or Nadia confirm the settings; Kit adds a test that a failed submission writes no body to the logs.
- Text fields are trimmed; empty after trimming counts as missing. Lengths are counted in Unicode code points (`[...s].length`), the same way in the browser and on the server.

## Responses (both endpoints)

| Status | Body | Page should |
| --- | --- | --- |
| `201` | `{ "ok": true, "receipt": "queued" \| "not_requested" }` | Show the sent state. |
| `200` | Same as the first `201` | A repeat of an already-stored `submissionId`; treat as sent. |
| `422` | `{ "ok": false, "errors": [ { "field": "email", "code": "invalid_email" } ] }` | Show the error summary and inline errors; keep all answers. |
| `403` | `{ "ok": false, "errors": [ { "field": "turnstileToken", "code": "turnstile_failed" } ] }` | Reset the widget, ask to try again; keep answers. |
| `400` | `{ "ok": false, "error": "bad_request" }` | Should never happen from our own page; show send failed. |
| `429` | `{ "ok": false, "error": "rate_limited", "retryAfter": 60 }` | Show send failed with "try again in a minute". |
| `5xx` or network error | `{ "ok": false, "error": "unavailable" }` or no body | Show send failed with Copy my answers; keep answers. |

`field` uses the request's field names, with dotted paths for nested ones (`answers.why_trustee`, `checks.over_18`). Error codes: `required`, `too_long`, `invalid_email`, `invalid_choice`, `unknown_field`, `under_18`, `not_independent`, `turnstile_failed`, `unknown_role`, `role_closed`.

## 1. Say hello: `POST /api/hello`

```json
{
  "submissionId": "uuid",
  "callName": "Fernfox",
  "email": "fernfox@example.invalid",
  "message": "Hello!",
  "turnstileToken": "..."
}
```

| Field | Rule |
| --- | --- |
| `callName` | Required, 1-60. Whatever name they want to be called; never "legal name". |
| `email` | Required, at most 254, basic syntax check only. |
| `message` | Required, 1-2000. |

Stored in D1 with a deletion date of **12 months after our last reply** (P3). On insert, `delete_after` is set to 12 months after receipt, and each reply we send pushes it to 12 months after that reply, so a message we never answer is still deleted. No receipt email for say hello in Sprint 1 (`receipt: "not_requested"`).

## 2. Apply: `POST /api/apply`

```json
{
  "submissionId": "uuid",
  "role": "trustee",
  "checks": { "over_18": "yes", "connection_to_founders": "not_sure", "trustee_rules_confirmed": "yes" },
  "callName": "Fernfox",
  "email": "fernfox@example.invalid",
  "answers": { "why_trustee": "...", "experience": "..." },
  "turnstileToken": "..."
}
```

| Field | Rule |
| --- | --- |
| `role` | Required, a slug from the role config. Sprint 1 accepts `trustee` only (Q3); other slugs return `role_closed`, unknown ones `unknown_role`. |
| `checks` | Step 1 answers, keyed by question id from the role config; values are that question's choice ids. Server refuses `over_18: "no"` with `under_18` (the page shows the under-18 exit first; this is the server's backstop). `connection_to_founders` (F3) accepts `related_or_household`, `friend_or_acquaintance`, `no` or `not_sure`. The server refuses `related_or_household` with `not_independent` (a backstop, like `under_18`); `friend_or_acquaintance` and `not_sure` (Q5) are accepted. Only the applicant's answer is stored: the admin page works out "conflict to declare" when it reads the row, with no separate flag column, and keeps this answer out of any counts or summaries. A refused answer returns `422` and stores nothing. `trustee_rules_confirmed` must be `yes`, otherwise `required`. |
| `callName`, `email` | As say hello. |
| `answers` | Step 3 answers, keyed by question id from the role config; each at most 2000; required ones per config. Unknown ids are refused with `unknown_field`. |

**Role config is shared:** the step 1 and step 3 question ids, choices and which are required live in `shared/forms/roles/<role>.ts`, and the wording lives in `i18n/locales/`. Both Mei's pages and Ade's validation use them. Web owns the wording; Services owns the ids. (`content/` is the Nuxt Content area for published policies, ADR-0002.)

Stored in D1 (stage 1 only: no legal details, P1). Deletion date: **6 months after we tell an unsuccessful applicant** (P3), so the "[six months]" placeholder in the copy is correct. Backstop for rows that never reach a decision (withdrawn, or the founding round closes without one being sent): **6 months after the round closes** (to be added to P3). A successful application moves into the trustee record (explained to the applicant at the time, P9) and leaves this table rather than being kept here.

A receipt email is queued after the row is stored (`receipt: "queued"`); a failed receipt never turns a stored application into a failure. The receipt is a fixed template ("we got your application") that confirms receipt only and never repeats the message, answers or checks, so the form cannot be used to send arbitrary text to a stranger. The email sending log (P3, 30 days) holds only the address and a template id.

The founder (later the chair and secretary, P3) reads applications on the admin page.

## Open points

1. **Q2 copy:** this contract follows P1 (messages and applications are saved to D1 with a deletion date), so "Nothing is saved on this site" has to change. The Web squad changes the copy; Ezra checks it against P9.
2. **Under-13s writing in** (P1 gap, P3 gap): area 5 has not decided. Until it does, we store messages as normal and do not ask for age on say hello (Head of Delivery, 25 October). Closes together with the P9 placeholder "[Area 5 to confirm how messages from under-13s are handled]". Safeguarding go-live condition (raised by Ezra with the Head of Delivery, not a blocker for this contract): before the form is public, an admin action passes a message to the safeguarding process and removes it from the say hello table, and whoever reads the inbox has a short note on handling a disclosure (SG6, SG-03).
3. **P9 and P6 wording:** we process the IP briefly for rate limiting, even though we never store it. Ezra to check that P9 and P6 mention short-lived use of connection details to stop abuse.
