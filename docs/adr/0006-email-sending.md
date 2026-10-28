# ADR-0006: Fixed-template email with a capture sink until we have a domain

- **Status:** Accepted (merged in #43, 26 October 2026)
- **Date:** 25 October 2026
- **Author:** Freya Lund (Email Engineer)
- **Reviewers:** Theo Marsh, Nadia Haddad, Ezra Quinn, Kit Morgan
- **Related:** issue #33, #27 (`email_log` table), #30 (first caller), #31 (deletion job), S3, P1 Phase 0, P3, `docs/api/forms.md`

## Context

S3 decided in-house sending for the platform's own emails. Sprint 1 needs one: the receipt for a trustee application. Three things shape the design.

- **No domain yet.** Sending properly needs a domain Kinmeet owns with SPF, DKIM and DMARC (P1 Phase 0). Until then nothing can be sent that would arrive or be trusted.
- **Abuse.** Anyone can type any address into a public form. If the email repeated what was typed, including the name, the form could be used to send a stranger words of an attacker's choosing. The Security Reviewer's review of the forms contract (b9f2115) set the rules: no name in the receipt, a plain "Hello,", and at most one receipt per address per day.
- **Privacy.** P3 keeps an email sending log for 30 days. The Privacy and Safeguarding Reviewer asked (25 October) that it holds a keyed HMAC of the address, not the address itself, because nothing in its purpose needs the clear address.

## Decision

- **Fixed templates only.** `queueEmail(event, { to, template, locale })` takes a template id and a locale and nothing else. Every email opens with "Hello," and never uses the name typed into the form. All text comes from `i18n/locales/` under `email`, so it is translation-ready and checked by `check:copy`. HTML parts have no links, images, remote styles or fonts, so nothing reports back when a message is opened. A test enforces this for every template.
- **Never in the way of a submission.** `queueEmail` never throws and logs an error code only. It returns the `receipt` value for the response: `queued`, or `not_requested` when the inbox is over its limit or email is not set up. It writes the log row before returning; the email is sent after the response, in `waitUntil`, and a send that fails there still leaves the answer as `queued`.
- **One receipt per inbox per day, counted in D1.** `queueEmail` inserts the `email_log` row only if there is no row for the same `to_hmac` from the last 24 hours, in one statement (`INSERT … SELECT … WHERE NOT EXISTS`, using the `(to_hmac, sent_at)` index from #41). D1 runs writes one at a time, so two submissions at the same moment cannot both pass, and there is nothing extra to keep (Tech Lead, contract e1127cd). `to_hmac` is taken from the inbox form of the address, which drops any `+tag` and, for Gmail, removes dots and treats `googlemail.com` as `gmail.com`, so `name+1@` and dotted variants cannot each get a receipt (Security Reviewer). Mail still goes to the address exactly as typed. A row written for a send that later fails still counts, which fails safe against abuse.
- **The log holds an HMAC.** `email_log` has `id`, `to_hmac` (HMAC-SHA-256 of the inbox form of the address, keyed with the Worker secret `EMAIL_LOG_HMAC_KEY`), `template_id`, `sent_at` and `delete_after` (30 days later), with times in Unix seconds. The table is created in #41 and deleted by #31. It lives in the main D1 database.
- **Transports.** `EMAIL_TRANSPORT` picks one; it defaults to `capture`, which keeps nothing when deployed (tests create their own instance with a small buffer) and logs the template id only. Nothing leaves the platform. A Cloudflare Email Service transport is added, with its own review, once a domain with SPF, DKIM and DMARC exists. An unknown transport name fails loudly instead of dropping mail.

## Options considered

| Option                                                  | For                                                                  | Against                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Capture sink until a domain exists (chosen)             | Nothing leaves the platform; code and tests are ready for the domain | "Receipt sent end to end" can only be shown once the domain exists (accepted risk, Head of Delivery, 25 October) |
| Send now from a third-party sender's shared domain      | Receipts arrive straight away                                        | A new processor not in S3 or P6; poor deliverability; would need a decision                                      |
| Capture into D1 or KV so staging receipts can be viewed | Easier to demo                                                       | Stores addresses and messages that P3 has no row for                                                             |
| Rate limiting binding for the per-address limit         | No storage of our own                                                | Periods of 60 seconds at most, approximate counts                                                                |
| A 24-hour KV marker per inbox                           | No D1 read                                                           | A second store with its own P3 row; eventually consistent, so simultaneous submissions both pass                 |
| Count recent rows in `email_log` for the limit (chosen) | One store, consistent, nothing extra to retain                       | One D1 write per receipt, which the log needs anyway                                                             |

## Consequences

- Every environment needs the secret `EMAIL_LOG_HMAC_KEY` and the `DB` binding (DevOps, #39). Without the secret, receipts are not sent, the response says `not_requested` and `email_log_hmac_key_missing` is logged.
- Until the domain exists, live has no real transport. The capture sink is allowed only where `KINMEET_ENV` is `local`, `test`, `preview` or `staging`. Everywhere else, including a Worker where the variable is missing or misspelt, `queueEmail` treats it as live and answers `not_requested` straight away, writing no log row or captured copy, so the page never says a receipt is coming when it is not (P9; Privacy and Safeguarding Reviewer; fail closed, Services EM). Local development needs `KINMEET_ENV` set to `local` to see receipts captured. The domain question goes to the founder at the M1 review.
- A suppression list (hard bounces and complaints) is not in P3 yet. When bounces are handled, it is stored as an HMAC only, after the Head of Delivery adds a P3 row.
- The deployed capture sink keeps no messages, so no clear address is held outside tests. Captured messages are a test aid, not a mailbox, and no route may ever serve them. A staging viewer would need its own privacy review.
- Every address passes a backstop before anything is claimed or sent: a control character (CR and LF included) or more than one `@` is refused with `email_invalid_address`, so no caller that forgets the forms schema can add a mail header.
- When the real transport is added, live must require an explicit `EMAIL_TRANSPORT` and fail loudly without one, rather than falling back to `capture` (Security Reviewer).

## Sources

- Cloudflare Workers rate limiting binding (periods of 10 or 60 seconds, approximate per location): https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/ , checked 25 October 2026.
- Web Crypto HMAC in Workers: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/ , checked 25 October 2026.
