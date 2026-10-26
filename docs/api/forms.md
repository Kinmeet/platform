# Forms API: say hello and apply

Owner: Services squad (Sol Ferreira). Agreed with the Web squad (Callum Reid) on 25 October 2026. This file is the source of truth for the two Sprint 1 form endpoints; change it by pull request, with both squads reviewing.

Sources: P1 Phase 1, P3 data map and retention, S5 (Turnstile). Not collected: pronouns and rough location (F8), and no "email me when the first meet is announced" flag until area 5 decides.

## Shared rules for both endpoints

- **Same origin only.** JSON over `POST`, with no CORS headers. The server refuses with `400 bad_request` unless `Origin` exactly matches the configured origin for this environment (staging or live, never derived from the request's `Host`), `Sec-Fetch-Site` is `same-origin` (when present), and `Content-Type` is exactly `application/json`, optionally followed by `; charset=utf-8`. A missing `Origin` or `Origin: null` is refused.
- **Body size cap.** Each form's cap is worked out from its schema's worst case: the maximum code points of every field × 4 bytes (UTF-8), plus 4 KB for JSON overhead, rounded up. That gives about 22 KB for say hello (the Turnstile token counts too) and about 64 KB for apply with the current trustee questions. The cap is computed in code from the schema, so it grows when the role config gains questions. The server counts bytes while reading the stream and stops at the cap, never trusting `Content-Length`. An oversized body gets `400 bad_request`. The cap counts raw bytes, so it also covers `\uXXXX` escapes (up to 12 bytes for one code point outside the Basic Multilingual Plane). Our own page sends unescaped UTF-8 from `JSON.stringify`, so only a hand-built body that escapes everything can hit the cap early.
- **Validation.** Zod 4 (Tech Lead, 25 October; ADR-0005). Each form has `shared/forms/<form>.ts`, which exports its schema and inferred type. Schemas never set messages; one helper, `shared/forms/errors.ts`, maps Zod issues to `{ field, code }`.
- **Shared schema.** One validation schema per form lives in `shared/forms/` and is imported by both the page (client checks) and the server route (the real check). The server never trusts the client check.
- **Error codes, not sentences.** The server returns a field name and a stable code; the page turns the code into translated text. No user-facing English comes from the API (P1 Phase 4: Welsh later).
- **Idempotent retries.** The page generates a random `submissionId` (UUID v4) once: when the say hello form loads, or when the apply flow starts. It is kept across steps and retries, sent with every attempt, and cleared only after a successful send, so it is never regenerated per step. The schema checks it is a UUID. Turnstile tokens are single-use, so every retry carries a fresh token. Turnstile is verified before the `submissionId` lookup, so nobody can probe for ids without solving a challenge. The id has a `UNIQUE` constraint and is written with `INSERT … ON CONFLICT DO NOTHING` followed by a read-back, so concurrent retries can never create two rows. A repeat returns only the first `{ ok, receipt }` and overwrites nothing, even when the body differs. The id is stored on the row itself, so it is deleted with the row and nothing outlives the submission. This is what lets "send failed" keep the answers and offer Try again without creating duplicates.
- **What is never stored or logged:** IP address, user agent, request body in logs, Turnstile token after verification (P3, P9).
- **Turnstile.** The token goes in `turnstileToken` (a string, at most 2048 characters) and is verified server-side before anything is stored (S5). The siteverify call sends only the secret and the token, never the optional `remoteip`. The server checks `success`, that `hostname` is this environment's host, and that `action` matches the form (the widget sets `data-action="hello"` or `"apply"`), so a token solved on one form can't be spent on the other. If siteverify times out or errors, the server fails closed: `5xx unavailable` and nothing stored.
- **Rate limiting** uses Cloudflare's rate limiting binding with the key `${form}:${hmac(network)}`, where `network` is the full address for IPv4 and the first 64 bits for IPv6 (most IPv6 connections get a whole /64). The HMAC uses its own Worker secret, shared with nothing else; the raw IP is never used, and the key is never logged. The per-network limit is generous (about 5 per 60 seconds per form), because schools, colleges and mobile networks share addresses. A global per-form limiter is a flood backstop. Counts live only inside Cloudflare and we write nothing. `retryAfter` matches the limiter's period. The binding counts per Cloudflare location and is approximate, so neither limit is a true worldwide cap; Turnstile is the real gate. Security sign-off: Nadia.
- **Receipt limit, by recipient.** At most 1 receipt per address per day. The check counts rows in the email sending log (`email_log`, D1) for the same `to_hmac` in the last 24 hours. `to_hmac` is an HMAC (with its own key, `EMAIL_LOG_HMAC_KEY`) of the address in "inbox" form: lowercased, `+tag` dropped, and for Gmail dots removed and `googlemail.com` counted as `gmail.com`. Mail still goes to the address as typed. A later submission to the same address is still stored and answered with `receipt: "not_requested"`. D1 is consistent, so there is no KV marker and nothing extra to retain (Tech Lead, 25 October).
- **Order of checks** (cheap ones first, so garbage never costs a siteverify call): method, origin and content type → size cap → per-network limit → global limit → parse and validate → Turnstile → idempotency lookup → store → receipt limit → queue receipt.
- **Logs.** The Worker sets `observability.logs.invocation_logs: false`, because by default invocation logs keep request headers, including `CF-Connecting-IP` and `User-Agent`, for days. Traces are off, or confirmed to carry no headers. There is no Logpush and no Tail Worker. Only our own `console.error` lines remain, and they log a code, never a request body. Jun sets this in the Wrangler config, Nadia confirms it, and Kit adds a test that checks the setting and that a failed submission writes no body to the logs.
- Text fields are trimmed; empty after trimming counts as missing. Lengths are counted in Unicode code points (`[...s].length`), the same way in the browser and on the server.

## Responses (both endpoints)

| Status                 | Body                                                                                       | Page should                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `201`                  | `{ "ok": true, "receipt": "queued" \| "not_requested" }`                                   | Show the sent state.                                         |
| `200`                  | Same as the first `201`                                                                    | A repeat of an already-stored `submissionId`; treat as sent. |
| `422`                  | `{ "ok": false, "errors": [ { "field": "email", "code": "invalid_email" } ] }`             | Show the error summary and inline errors; keep all answers.  |
| `403`                  | `{ "ok": false, "errors": [ { "field": "turnstileToken", "code": "turnstile_failed" } ] }` | Reset the widget, ask to try again; keep answers.            |
| `400`                  | `{ "ok": false, "error": "bad_request" }`                                                  | Should never happen from our own page; show send failed.     |
| `429`                  | `{ "ok": false, "error": "rate_limited", "retryAfter": 60 }`                               | Show send failed with "try again in a minute".               |
| `5xx` or network error | `{ "ok": false, "error": "unavailable" }` or no body                                       | Show send failed with Copy my answers; keep answers.         |

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

| Field            | Rule                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `callName`       | Required, 1-60. Whatever name they want to be called; never "legal name".                                                                                                |
| `email`          | Required, at most 254, basic syntax check only; refused with `invalid_email` if it contains CR, LF or any other control character, so it can never inject a mail header. |
| `submissionId`   | Required, a UUID (see shared rules).                                                                                                                                     |
| `turnstileToken` | Required, a string of at most 2048 characters.                                                                                                                           |
| `message`        | Required, 1-2000.                                                                                                                                                        |

Stored in D1 with a deletion date of **12 months after our last reply** (P3). On insert, `delete_after` is set to 12 months after receipt, and each reply we send pushes it to 12 months after that reply, so a message we never answer is still deleted. No receipt email for say hello in Sprint 1 (`receipt: "not_requested"`).

## 2. Apply: `POST /api/apply`

```json
{
  "submissionId": "uuid",
  "role": "trustee",
  "checks": {
    "over_18": "yes",
    "connection_to_founders": "not_sure",
    "trustee_rules_confirmed": "yes"
  },
  "callName": "Fernfox",
  "email": "fernfox@example.invalid",
  "answers": { "why_trustee": "...", "experience": "..." },
  "turnstileToken": "..."
}
```

| Field               | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `role`              | Required, a slug from the role config. Sprint 1 accepts `trustee` only (Q3); other slugs return `role_closed`, unknown ones `unknown_role`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `checks`            | Step 1 answers, keyed by question id from the role config; values are that question's choice ids. Server refuses `over_18: "no"` with `under_18` (the page shows the under-18 exit first; this is the server's backstop). `connection_to_founders` (F3) accepts `related_or_household`, `friend_or_acquaintance`, `no` or `not_sure`. The server refuses `related_or_household` with `not_independent` (a backstop, like `under_18`); `friend_or_acquaintance` and `not_sure` (Q5) are accepted. Only the applicant's answer is stored: the admin page works out "conflict to declare" when it reads the row, with no separate flag column, and keeps this answer out of any counts or summaries. A refused answer returns `422` and stores nothing. `trustee_rules_confirmed` must be `yes`, otherwise `required`. |
| `callName`, `email` | As say hello.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `answers`           | Step 3 answers, keyed by question id from the role config; each at most 2000; required ones per config. Unknown ids are refused with `unknown_field`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

**Role config is shared:** the step 1 and step 3 question ids, choices and which are required live in `shared/forms/roles/<role>.ts`, and the wording lives in `i18n/locales/`. Both Mei's pages and Ade's validation use them. Web owns the wording; Services owns the ids. (`content/` is the Nuxt Content area for published policies, ADR-0002.)

Stored in D1 (stage 1 only: no legal details, P1). Deletion date: **6 months after we tell an unsuccessful applicant** (P3), so the "[six months]" placeholder in the copy is correct. Backstop for rows that never reach a decision (withdrawn, or the founding round closes without one being sent): **6 months after the round closes** (built as the default; a proposed change to P3 awaiting the founder's agreement). A successful application moves into the trustee record (explained to the applicant at the time, P9) and leaves this table rather than being kept here.

A receipt email is queued after the row is stored (`receipt: "queued"`); a failed receipt never turns a stored application into a failure. The receipt is a fixed template ("we got your application") that confirms receipt only and never includes the call name, message, answers or checks (it opens with a plain "Hello,"), so the form cannot be used to send arbitrary text to a stranger. The email sending log (P3, 30 days) holds only the address and a template id.

The founder (later the chair and secretary, P3) reads applications on the admin page.

## For the admin page (later tickets)

Every field in these rows is attacker-controlled text. The admin page renders it as plain text only, never `v-html` (ADR-0004), and strips or shows bidirectional override and control characters so a name can't disguise itself to the reader.

## Open points

1. **Q2 copy:** this contract follows P1 (messages and applications are saved to D1 with a deletion date), so "Nothing is saved on this site" has to change. The Web squad changes the copy; Ezra checks it against P9.
2. **Under-13s writing in** (P1 gap, P3 gap): area 5 has not decided. Until it does, we store messages as normal and do not ask for age on say hello (Head of Delivery, 25 October). Closes together with the P9 placeholder "[Area 5 to confirm how messages from under-13s are handled]". Safeguarding go-live condition (raised by Ezra with the Head of Delivery, not a blocker for this contract): before the form is public, an admin action passes a message to the safeguarding process and removes it from the say hello table, and whoever reads the inbox has a short note on handling a disclosure (SG6, SG-03).
3. **P9 and P6 wording:** we process the IP briefly for rate limiting, even though we never store it. Ezra to check that P9 and P6 mention short-lived use of connection details to stop abuse.
