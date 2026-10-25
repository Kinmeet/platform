# Forms API: say hello and apply

Owner: Services squad (Sol Ferreira). Agreed with the Web squad (Callum Reid) on 25 October 2026. This file is the source of truth for the two Sprint 1 form endpoints; change it by pull request, with both squads reviewing.

Sources: P1 Phase 1, P3 data map and retention, S5 (Turnstile). Not collected: pronouns and rough location (F8), and no "email me when the first meet is announced" flag until area 5 decides.

## Shared rules for both endpoints

- **Same origin only.** JSON over `POST`, `Content-Type: application/json`. No CORS headers; requests from another origin are refused.
- **Shared schema.** One validation schema per form lives in `shared/forms/` and is imported by both the page (client checks) and the server route (the real check). The server never trusts the client check. Library is Theo's call (Zod or Valibot suggested).
- **Error codes, not sentences.** The server returns a field name and a stable code; the page turns the code into translated text. No user-facing English comes from the API (P1 Phase 4: Welsh later).
- **Idempotent retries.** The page generates a random `submissionId` (UUID v4) when the form first loads and sends it every time. A repeat with the same id returns the first result and stores nothing new. This is what lets "send failed" keep the answers and offer Try again without creating duplicates.
- **What is never stored or logged:** IP address, user agent, request body in logs, Turnstile token after verification (P3).
- **Turnstile** token in `turnstileToken`, verified server-side before anything is stored (S5).
- Text fields are trimmed; empty after trimming counts as missing. Lengths are in characters.

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

`field` uses the request's field names, with dotted paths for nested ones (`answers.why_trustee`, `checks.over_18`). Error codes: `required`, `too_long`, `invalid_email`, `invalid_choice`, `under_18`, `turnstile_failed`, `unknown_role`, `role_closed`.

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

Stored in D1 with a deletion date: **12 months after the last reply** (P3). No receipt email for say hello in Sprint 1 (`receipt: "not_requested"`).

## 2. Apply: `POST /api/apply`

```json
{
  "submissionId": "uuid",
  "role": "trustee",
  "checks": { "over_18": "yes", "connected_to_founders": "not_sure", "trustee_rules_confirmed": "yes" },
  "callName": "Fernfox",
  "email": "fernfox@example.invalid",
  "answers": { "why_trustee": "...", "experience": "..." },
  "turnstileToken": "..."
}
```

| Field | Rule |
| --- | --- |
| `role` | Required, a slug from the role config. Sprint 1 accepts `trustee` only (Q3); other slugs return `role_closed`, unknown ones `unknown_role`. |
| `checks` | Step 1 answers, keyed by question id from the role config; values are that question's choice ids. Server refuses `over_18: "no"` with `under_18` (the page shows the under-18 exit first; this is the server's backstop). `connected_to_founders` accepts `yes`, `no` or `not_sure` (Q5). `trustee_rules_confirmed` must be `yes`, otherwise `required`. |
| `callName`, `email` | As say hello. |
| `answers` | Step 3 answers, keyed by question id from the role config; each at most 2000; required ones per config. Unknown ids are refused with `invalid_choice`. |

**Role config is shared:** the step 1 and step 3 question ids, choices and which are required live in one file per role (`content/roles/<role>`), used by Mei's pages and Ade's validation. Web owns the wording; Services reads the ids.

Stored in D1 (stage 1 only: no legal details, P1). Deletion date: **6 months after we tell an unsuccessful applicant** (P3), so the "[six months]" placeholder in the copy is correct. A receipt email is queued after the row is stored (`receipt: "queued"`); a failed receipt never turns a stored application into a failure. Matt reads applications on the admin page.

## Open points

1. **Q2 copy:** this contract follows P1 (messages and applications are saved to D1 with a deletion date), so "Nothing is saved on this site" has to change. The Web squad changes the copy; Ezra checks it against P9.
2. **Under-13s writing in** (P1 gap, P3 gap): area 5 has not decided. Until it does, we store messages as normal and do not ask for age on say hello. Raised with the Head of Delivery.
3. **Rate limiting without storing IPs:** propose Cloudflare's rate limiting binding keyed in memory only, nothing written to D1 or logs. Theo and Nadia to confirm.
