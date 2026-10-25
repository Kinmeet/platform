# ADR-0005: Fixed-template email with a capture sink until we have a domain

- **Status:** Proposed
- **Date:** 25 October 2026
- **Author:** Freya Lund (Email Engineer)
- **Reviewers:** Theo Marsh, Nadia Haddad, Ezra Quinn, Kit Morgan
- **Related:** issue #33, #27 (`email_log` table), #30 (first caller), #31 (deletion job), S3, P1 Phase 0, P3, `docs/api/forms.md`

## Context

S3 decided in-house sending for the platform's own emails. Sprint 1 needs one: the receipt for a trustee application. Three things shape the design.

- **No domain yet.** Sending properly needs a domain Kinmeet owns with SPF, DKIM and DMARC (P1 Phase 0). Until then nothing can be sent that would arrive or be trusted.
- **Abuse.** Anyone can type any address into a public form. If the email repeated what was typed, the form could be used to send a stranger words of an attacker's choosing.
- **Privacy.** P3 keeps an email sending log for 30 days. The Privacy and Safeguarding Reviewer asked (25 October) that it holds a keyed HMAC of the address, not the address itself, because nothing in its purpose needs the clear address.

## Decision

- **Fixed templates only.** `queueEmail(event, { to, template, locale })` takes a template id and a locale and nothing else. All text comes from `i18n/locales/` under `email`, so it is translation-ready and checked by `check:copy`. HTML parts have no links, images, remote styles or fonts, so nothing reports back when a message is opened. A test enforces this for every template.
- **Never in the way of a submission.** `queueEmail` runs in `waitUntil`, never throws, and logs an error code only. Callers always answer `receipt: "queued"`.
- **Per-address limit from the log itself.** At most 3 copies of one template go to one address in 24 hours, counted from `email_log`. Cloudflare's rate limiting binding only offers 10 or 60 second periods and counts approximately per location, which is too short for this; the log already exists, so no new data is kept.
- **The log holds an HMAC.** `email_log` has `id`, `to_hmac` (HMAC-SHA-256 of the trimmed, lower-cased address, keyed with the Worker secret `EMAIL_LOG_HMAC_KEY`), `template_id`, `sent_at` and `delete_after` (30 days). The table is created in #27 and deleted by #31. It lives in the main D1 database.
- **Transports.** `EMAIL_TRANSPORT` picks one; it defaults to `capture`, which keeps the last 20 messages in the isolate's memory and logs the template id only. Nothing leaves the platform. A Cloudflare Email Service transport is added, with its own review, once a domain with SPF, DKIM and DMARC exists. An unknown transport name fails loudly instead of dropping mail.

## Options considered

| Option                                                  | For                                                                  | Against                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capture sink until a domain exists (chosen)             | Nothing leaves the platform; code and tests are ready for the domain | "Receipt sent end to end" can only be shown once the domain exists (accepted risk, Head of Delivery, 25 October) |
| Send now from a third-party sender's shared domain      | Receipts arrive straight away                                        | A new processor not in S3 or P6; poor deliverability; would need a decision                                      |
| Capture into D1 or KV so staging receipts can be viewed | Easier to demo                                                       | Stores addresses and messages that P3 has no row for                                                             |
| Rate limiting binding for the per-address limit         | No D1 read                                                           | Periods of 60 seconds at most, approximate counts                                                                |

## Consequences

- Every environment needs the secret `EMAIL_LOG_HMAC_KEY` (DevOps, with #4). Without it, receipts are not sent and `email_log_hmac_key_missing` is logged.
- Until the domain exists, the live environment also uses the capture sink, so no receipts reach applicants. The domain question goes to the founder at the M1 review.
- A suppression list (hard bounces and complaints) is not in P3 yet. When bounces are handled, it is stored as an HMAC only, after the Head of Delivery adds a P3 row.
- Captured messages live only in one isolate's memory and disappear when it is recycled; they are a test aid, not a mailbox.

## Sources

- Cloudflare Workers rate limiting binding (periods of 10 or 60 seconds, approximate per location): https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ , checked 25 October 2026.
- Web Crypto HMAC in Workers: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ , checked 25 October 2026.
