# ADR-0010: Forms built on the site, and a mail platform reimplemented from mailflare

- **Status:** Accepted (merged in #154, 28 October 2026)
- **Date:** 28 October 2026
- **Author:** Theo Marsh (Tech Lead)
- **Reviewers:** Nadia Haddad, Ezra Quinn, Robin Achterberg, Rowan Hale; input from Sol Ferreira, Callum Reid, Mei Lin Tan, Freya Lund, Ines Duarte
- **Related:** issue #153, research #155; S1, S2, S3, S5, S9, SG6, P3, P4, P5; ADR-0005, ADR-0006, ADR-0008; #43, #48, #80, #91, #97

## Context

The founder corrected the platform's direction on 28 October 2026. It has to be powerful and more generic. Applications and forms should be created on the site, not custom-built in code each time. On the mail side, we are in effect reimplementing mailflare on Nuxt and adding what Kinmeet needs.

What we have today:

- Two forms, each with its own code path: say hello (#48) and the trustee application (#80).
- Each form has its own table (`hello_messages`, `applications`).
- The role config is written in TypeScript (`shared/forms/roles/`), and its copy lives in `i18n/locales/`.
- Fixed-template email with a capture sink (ADR-0006, #43, #97).
- An encrypted hand-over to safeguarding for each table (#91).
- The engine underneath is already mostly generic (Sol's map): `handleFormSubmission`, the check order in `process.ts`, Turnstile with an expected action, per-form rate limiting, and the field primitives in `shared/forms/fields.ts`.

mailflare (mailflare.co, the same project as `hieunc229/mailflare`) is a self-hosted mailbox suite: domains, shared mailboxes, routing rules, a calendar and a drive. Its listing says it is AGPL. Our code is public but not licensed for reuse (S9). Copying or translating AGPL code would put the platform under the AGPL.

Forces that don't move:

- **Firm rules.** No tracking or third-party requests, except Turnstile on form pages. No personal data in the repository or logs. People in roles appear by title only. Encrypted areas stay unreadable by the server, with the recorded interim exception for `safeguarding_items`.
- **Privacy.** Every field maps to a row in P3, and only the Head of Delivery can add a new kind of personal data. Every row gets a deletion date when it is stored. Access follows P4. Area 5 has parked the newsletter rules and the under-13s question.
- **Safeguarding.** Under SG6, every free-text route needs a hand-over to the safeguarding lead.
- **Copy.** British English, the terminology rules and plain English apply, and text must be translation-ready.
- **Security.** Strict CSP, Turnstile verified on the server, a body cap enforced before Nitro (ADR-0008), bound SQL only, no `v-html` with anything we didn't write.

## Decision

**How we read the founder's ask.** "We should just be able to create it on the site" means that admins holding a P4 role build forms on the site. It doesn't mean anyone can. Rowan recorded this reading on the founder's decision card, and the founder can widen it later.

We build **one forms engine driven by versioned definitions stored in D1**, and a **mail platform that reimplements mailflare's features without copying its code**. Both work within limits that stay in reviewed code: field types, P3 purposes, P4 roles, stop reasons and the safeguarding rules. Admins compose; they don't invent new kinds of data, new retention rules or new security behaviour.

### 1. Forms engine

**Definitions are data, and published versions never change.**

- `forms` has one row per form, holding its id, slug, kind (`form` or `application`), status (`draft`, `open`, `closed`) and current version.
- `form_versions` holds each published version: its definition JSON, its text per locale, its P3 purpose id, and when and by whom it was published.
- A trigger refuses any `UPDATE` to a published version, as `audit_log` already does.
- Editing makes a new draft. Publishing it makes a new version.
- Every submission stores the version it was filled in on, so old answers keep their labels and are validated against the rules that applied when they were sent. This answers Sol's question 1 and Mei's question on where versioned config lives.

**What a definition holds.**

- Steps: at most 4 to start, as Mei proposed. Each step has a heading and at most 10 fields.
- Fields, drawn from a **fixed field-type library in code** of exactly six types: `short_text`, `long_text`, `email`, `call_name`, `single_choice` and `confirm` (Mei, Robin B2). A community name is a `call_name`. Any other type, such as a date, needs its own decision, a P3 row, and an accessible pattern (for example a day, month and year fieldset), in a reviewed PR.
- Each field sets its own id, `required` flag, choices, and a `maxLength` up to its type's hard maximum.
- Simple show-if conditions, on an earlier choice field only. **The server enforces them.** An answer to a field that its condition hides is refused, and never stored, even if the client sends it (Nadia, Ezra).
- Stop outcomes, taken only from the fixed list (`under_18`, `not_independent`). A new stop reason needs a decision and a PR.
- The receipt email to send, or none.
- The admin actions that apply: reply, outcome told, pass to safeguarding.
- The P4 roles that may read submissions. These may only narrow the purpose's reader roles (see below).
- "About you" (call name and email) and "Check and send" are always there, and can't be removed or reordered.
- No field type ever collects a legal name, a postal address, a date of birth, an IP address, or anything else on the never-store list. A new field type is a reviewed PR with its own P3 row.
- No field may ask for a password, bank or card details, or a code. Publish-time text checks refuse labels that do, so nobody can use our name to collect credentials (Nadia).
- Drafts of a submission are held in memory only, never in browser storage, as today (#85, #100). Nothing like "save and come back later" exists without its own P3 row.

**Limits on definitions.** The definition schema bounds everything the run-time schema is built from (Nadia):

- the number of steps, fields per step, and choices per field;
- the length of labels, hints and choices;
- the total size of the definition.

The run-time schema is cached per version.

**Validation.** The definition itself is checked by a Zod schema when it is saved and when it is published. The submission schema is built from the stored version at run time, using the existing primitives in `fields.ts`, as `shared/forms/apply.ts` already does from the role config. ADR-0005 stands: Zod, `jitless`, the same codes on the client and the server, and `unknown_field` for any id not in the version.

**Retention and lawful basis come from a P3 purpose, not from the form.** `shared/privacy/purposes.ts` is a reviewed list in code, with one entry per P3 row. Each purpose holds:

- the lawful basis;
- the retention rule: a base event (`received`, `replied`, `outcome_told`), a period, and an optional backstop such as the round close date;
- which field types it allows;
- whether it allows free text;
- the widest set of P4 roles that may read what it collects (Ezra).

A form must name one purpose before it can be published. It may shorten the retention period and narrow the reader roles, never lengthen or widen them. Mailboxes follow the same rule.

Forms don't ask anyone's age unless a purpose needs it. A purpose designed for children waits for area 5's rule on under-13s, as the mailing list does (Ines's clash 4). Some purposes can't become stored forms until area 5 has written the rules they depend on. The SG4 volunteer self-declaration, which is criminal-record data, waits for the appropriate policy document (area 5 open item 3). It gets no purpose until then, so nobody can build it early (Ezra). Area 5 still owns the rules, and admins can't create a new kind of personal data on the site. This differs from Sol's proposal, which put retention in the form, because the privacy rule gives that decision to area 5.

**Safeguarding is built in, not optional.**

- Any form whose purpose allows free text gets the "pass to safeguarding" action and the safety note (SG6, SG-03, go-live condition 7). The builder adds both and can't remove them.
- The hand-over becomes one function over `form_submissions`, with the form slug inside the ciphertext. That also settles the #117 point about item ids revealing the form.
- Only `server/safeguarding/` touches `safeguarding_items`, as now.

**URLs, CSP, Turnstile and body caps.** This answers Sol's question 3.

- Pages live at fixed prefixes: `/forms/<slug>`, and `/roles/<slug>/apply` for applications.
- The API lives at one route, `POST /api/forms/<slug>`.
- `/forms/*` and `/roles/*/apply` are form routes for the CSP by their prefix, so publishing a form never changes the security headers.
- A draft or closed form answers 404, as the draft pages do today.
- The Turnstile action is the slug. Slugs are therefore limited to 32 characters of `[a-z0-9-]`, and siteverify checks the action.
- Slugs are unique ignoring letter case, and a reserved list in code (for example `admin`, `api`, `safeguarding`, `new`, `edit`) can't be used.
- Rate limiting stays keyed per form, and one global limiter across all forms stops a flood being spread over many slugs (Nadia).
- The Worker entry (ADR-0008) keeps one fixed cap for `/api/forms/*`, as a constant in code. Publishing refuses any version whose `bodyCapBytes` is over that constant, and a test shows that the largest allowed definition still fits (Nadia). The handler then applies the form's own cap after loading the version.

**Copy.** This answers Sol's question 2.

- Fixed text stays in `i18n/locales/`: buttons, step names, error messages and the safety notices.
- Admins never write error messages. Each field type has fixed messages, each a whole sentence that doesn't need the label, such as "Choose one answer." Admin text is never glued into a fixed sentence. The error summary names the question beside the message ("{question}: {message}"), as #74 does (Robin B1).
- Admin text (labels, hints, headings, intros, choices) is stored under a key for each locale with the version, with an `en-GB` fallback, so it's ready for Welsh. `en-GB` is required. A form publishes in `en-GB` only until a translation decision exists.
- Admin text is translation-ready data, not hard-coded copy, so it meets the intent of the copy rule. The rule file will say so.
- Publishing runs the same checks as `check:copy` on the server: terminology, British English, and no names of people in roles. Any failure blocks publishing. Long sentences only warn.
- Admin text is always rendered as text, never as HTML. It is never autolinked or treated as Markdown, whether on pages, in previews or in email. A URL typed into a label stays plain text (Nadia).

**Who may publish.**

- Publishing needs the `forms.publish` permission, which P4 gives to trustees (the founder until then).
- Publishing is a sensitive action. It asks for the passkey again and writes an audit entry (Nadia).
- **A second person with the privacy role must approve** any change to what is collected or who sees it (Ezra):
  - a new form;
  - a new or changed field;
  - a change of purpose or of reader roles;
  - any form whose purpose covers special-category data, criminal-record data or children, such as parent and carer consent.

  Edits to wording alone publish on the copy checks. The reason is that a `single_choice` can quietly ask about health or sexuality, and only a person catches that.

- While the founder holds every role, there is no second person. In Phase 1, a version that needs a second approval can't publish, unless the founder decides that the second check may be done outside the platform and recorded in the audit log. That question goes to the founder through Rowan.
- Publishing is a change of data, not a code release, so it doesn't need the founder's live-release approval. The engine it runs on does.

**Access by role.** Every admin read and write goes through a role check against the form's P4 roles. Sensitive actions write to `audit_log`. Its action and table CHECKs move to the generic names in a migration. Existing entries stay as they are, because the triggers refuse updates. The admin page reads both the old and new table names.

**Testing.**

- Each P3 purpose gets a retention test.
- Each field type gets a renderer test, an axe scan and the 320px check, using a fixture form that local and e2e D1 seed with every field type.
- `publicRoutes` gains the fixture forms, so the no-third-party, CSP and accessibility tests load them automatically.
- A migration test checks that `delete_after` is unchanged on every copied row.

**Role pages.** The role page (sections, "at a glance", next steps) becomes stored content linked to its application form, rendered by a page renderer under the same text and copy rules. Its tables and screens come in a later phase of this ADR, not a separate ADR.

### 2. Mail platform

mailflare is AGPL-3.0 (Ines, `docs/research/mailflare.md` in #155). We reimplement its features for Kinmeet on Cloudflare Email Service, as a clean room (Nadia):

- implementers don't read mailflare's source at all, and work only from Ines's research note, its public feature list and our decisions;
- every phase PR says "no mailflare code used".

We don't need a licence for that, and the platform keeps its S9 terms. mailflare is a React app on vinext, so nothing would carry over to Nuxt directly anyway.

We leave out mailflare's:

- open-tracking pixels;
- remote images loading by default;
- IP addresses, user agents and cities in its sign-in log;
- AI agents and its MCP server;
- push notifications;
- third-party senders;
- licence check;
- account-wide API token. Calendar and drive are out of scope. Each would need its own ADR and decision.

**Mailboxes and routing**, the port:

- Domains and role addresses, such as `hello@` or `trustees@`, are configured on the site and kept in D1.
- Inbound mail reaches the Worker's `email()` handler through Email Routing. We add it in `worker/entry.ts` beside `fetch`.
- `postal-mime` parses the message. This is a new dependency, MIT licensed and the one Cloudflare's docs use.
- **We keep no raw MIME.** Its `Received:` and similar headers carry IP addresses, which we never store (privacy rule; Ezra). We keep:
  - the text part and the HTML part;
  - the few headers we need: `From`, `To`, `Subject`, `Date`, `Message-ID`, `In-Reply-To` and `References`, plus the SPF, DKIM and DMARC results as verdicts only, never the header text, which can carry the sending IP (Nadia);
  - the attachments.
    The parts go into D1, and attachments go into private R2 in the EU jurisdiction under random names. If parsing fails, the message is rejected and nothing is kept. Logs carry a code and ids only.
- Over-size messages are refused before parsing, and parsing is written with the Workers CPU budget in mind.
- Each general address has one of two routing rules: store in a shared mailbox, or reject. **General mailboxes never forward.** A forward would put a copy outside our deletion job, audit log and access rules (Ezra). Catch-all is off.
- Routing rules are data, as in mailflare. Each rule matches on sender, recipient, subject or content, with an operator and a priority. Its only actions are to file into a folder of a shared mailbox, or to reject.
- Mailboxes have aliases, folders, threads and search.
- A shared mailbox has P4 roles for reading, assigning and replying, bounded by its purpose.
- Replies go out through the `send_email` binding with `In-Reply-To` and `References`. The binding is limited with `allowed_sender_addresses` to our role addresses.
- **Loop protection.** We never send an automatic reply to a message whose `Auto-Submitted` is anything other than `no`, or that has a `List-*` or `Precedence: bulk` header.
- **Spoofing.** Each message shows its SPF, DKIM and DMARC results. A `From` that claims one of our role addresses or domains but fails DMARC is flagged. That matters for safeguarding too, because people may impersonate role holders (Nadia).
- Each mailbox names a P3 purpose for retention, as forms do. The deletion job removes the D1 rows and the R2 attachments together. `privacy@` also needs its own P3 row for records of rights requests (Ezra).
- **The safeguarding address is never a plain mailbox.** Until it's decided otherwise, it accepts into the encrypted store only, and never writes any part of a message or its attachments to R2 in plain (SG6, firm rule 5).
  - Forwarding it to the safeguarding lead's own inbox would put disclosures in plain text in a personal inbox. That is a founder decision under SG-03 and the #95 exception, not an engineering default.
  - If inbound safeguarding mail can't be encrypted this way, the address stays unbuilt (Ezra).
  - Any automatic reply or bounce from the safeguarding address uses fixed wording that points to 999 and the web form, and never echoes the message. Ezra and the SG-03 owner agree the wording (Nadia).
- **Every general mailbox has "pass to safeguarding"**, as forms do. The hand-over moves the message and its attachments into the encrypted store. The plain copies in D1 and R2 are deleted only after the encrypted copy has been checked, so nothing stays behind (Nadia, Ezra).
- **Viewing mail safely** (Nadia's settings):
  - The text part is shown by default.
  - HTML is shown in an iframe with an empty `sandbox` attribute: no `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-popups` or `allow-top-navigation`. It also has `referrerpolicy="no-referrer"`.
  - The frame's response carries:
    - `Content-Security-Policy: default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'self'; base-uri 'none'`;
    - `Referrer-Policy: no-referrer`, `nosniff` and `Cache-Control: no-store`.
  - The mailbox page alone gets `frame-src 'self'`, as a reviewed route rule. Everywhere else it stays `'none'`.
  - As a safety net, the HTML is also sanitised on the server before it is stored. Script, iframe, object, embed, form, base, `meta http-equiv`, link elements and event attributes are removed. `cid:` references are rewritten to our permission-checked image route, and every other `src` is dropped, so remote images (and tracking pixels) never load.
  - Links in mail don't navigate from the sandbox. The real URL is shown as text beside each link.
  - Attachments are served only after a permission check, with:
    - `Content-Type: application/octet-stream` whatever the sender declared;
    - `Content-Disposition: attachment` with a sanitised filename (RFC 6266, no CR or LF, no path);
    - `nosniff`, `Content-Security-Policy: sandbox` and `no-store`.
  - Attachments follow the file rules (random names, size and type checks) and have no inline preview. The interface says plainly that we don't scan attachments.

**Sending, suppression and logs.**

- The capture transport stays.
- An Email Service transport is added once a domain with SPF, DKIM and DMARC exists, as ADR-0006 already says.
- Live must name its transport explicitly, and fails loudly without one.
- Delivery events (`delivered`, `deferred`, `bounced`, `failed`, `rejected`, `complained`) arrive through a Queues event subscription per sending domain.
- Our consumer stores an HMAC of the address with the event type and time. It never logs the payload, which carries the clear address (Freya).
- The consumer is idempotent and logs codes only. The queue keeps messages for the shortest retention it allows. It has no dead-letter queue, or one with the same short retention. The Worker has no producer binding for it, so our own code can't inject events (Nadia).
- Email Service keeps its own suppression list: complaints never expire, hard bounces last 7 days, and soft bounces last 24 hours. That means our processor holds complaint addresses in clear with no end date.
  - P9 and the suppression P3 row must say so.
  - The erasure runbook must say whether we delete an address from that list on request. The suppressions API allows deletes (Ezra).
- We also keep an HMAC-only suppression table for our own decisions, such as unsubscribes. That table needs its own P3 row first, and the row also covers the queue.
- We prefer not to add manual suppressions to Cloudflare, because that would put addresses there under a new P3 note.
- `email_log` keeps its HMAC design. Its `template_id` CHECK and the per-inbox window become per-template settings.

**Templates.**

- Publicly triggered emails, such as receipts, keep ADR-0006's anti-abuse rules: they never include anything the submitter typed, they say "Hello," only, and each inbox gets at most one per window.
- Their wording becomes admin-editable stored text per locale, under the same copy checks.
- Templates for campaigns and replies are written by signed-in admins.
- No email carries tracking. That means no open pixels, no click redirects and no tracking parameters (firm rule 1).
- **Links are own-origin only and built by code** (Nadia). This replaces ADR-0006's "no links" rule.
  - Code builds each link from `SITE_ORIGIN` and a fixed path. A link never contains anything a submitter typed.
  - Admins can't add their own `href`. Admin-written campaign text goes through our renderer, never raw HTML, and every link is checked to be own-origin when the email is sent.
  - A receipt or other publicly triggered email may carry only a confirm or unsubscribe link, nothing else.
- **Tokens** are random, at least 128 bits, stored only as a hash, single-use and expiring. An unsubscribe token may be a per-recipient HMAC, as long as it can't be guessed from the address.
- **A GET never changes state.** Mail scanners and link previewers follow links, so confirmation and unsubscribe pages show a button that POSTs. One-click unsubscribe uses RFC 8058's `List-Unsubscribe-Post`.

**Newsletters**, only if the founder chooses them:

- lists, contacts and memberships;
- double opt-in, with hashed and expiring confirmation tokens;
- a one-click unsubscribe header (RFC 8058) and an unsubscribe page;
- campaigns sent through a Queue, within Email Service's daily limits.

We build the mechanism, but nothing is collected until area 5 decides the newsletter rules (double opt-in, retention, minimum age) and the under-13s question. Until then the code ships with its P3 purpose missing, so a list can't be opened.

### 3. Migration: nothing merged is thrown away

| Phase          | What happens                                                                                                                                                                                                                                                                                                                                 | Proof                                                                                        |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A. Engine      | Add `forms`, `form_versions` and `form_submissions`. Seed say hello and the trustee application as version 1, from today's config and copy. Copy both tables in with `INSERT … SELECT`, keeping `id`, `submission_id`, `received_at` and `delete_after` unchanged (Sol). `/say-hello` and `/roles/trustee/apply` render the stored versions. | Today's e2e and unit tests pass unchanged against the stored config, plus the migration test |
| B. Builder     | Admin screens to build, preview, publish and close forms, behind Access, following Callum's redesigned canvas. Generic submission lists and the hand-over.                                                                                                                                                                                   | Fixture forms of every field type in the e2e routes                                          |
| C. Clean-up    | Drop `hello_messages`, `applications`, the TypeScript role config and the per-form copy keys. This is a separate migration, once the deletion job and the admin page have run on the new tables.                                                                                                                                             | Retention test for each purpose                                                              |
| D. Mailboxes   | Inbound mail, shared mailboxes, replies and suppression events. Starts once a domain is bought.                                                                                                                                                                                                                                              | Local `email()` tests with Wrangler's local email endpoint                                   |
| E. Newsletters | Only if chosen, and after area 5.                                                                                                                                                                                                                                                                                                            | Retention and opt-in tests                                                                   |

We don't touch the `safeguarding_items` rows. Existing ciphertext stays keyed by the old row ids.

The SG4 volunteer self-declaration isn't in any phase until area 5's appropriate policy document exists.

Every phase PR names the Security Reviewer as a required reviewer for the parts it touches:

- the publish checks and the run-time schema builder;
- the mailbox viewer route and attachments;
- the `email()` handler, the queue consumer and token handling.

It also names the Privacy and Safeguarding Reviewer for `purposes.ts`, the hand-over and every new P3 purpose.

## Options considered

| Option                                                               | For                                                                                                                        | Against                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stored, versioned definitions within reviewed limits (chosen)        | Admins build forms without code. Privacy, safeguarding and security rules stay in code, where they are reviewed and tested | More engine code. Admin text bypasses PR review, so publish-time checks must be strict                                                                                                                                                                                                                                              |
| Keep forms in TypeScript config, one PR per form                     | Every form is reviewed; no new surface                                                                                     | It's exactly what the founder asked us to stop                                                                                                                                                                                                                                                                                      |
| Fully free-form builder (any field, any retention)                   | Most flexible                                                                                                              | Breaks the privacy rule: admins could create new kinds of personal data and their own retention                                                                                                                                                                                                                                     |
| Render with FormKit 2.1.2, generating its schema from our definition | Maintained; no eval in core; runs on Workers (Ines, #155)                                                                  | Our own components already render all six field types to our accessibility rules (#74, #85). FormKit sets no `aria-invalid`, and would fetch its theme and icons from jsDelivr unless both are turned off. It would be a second set of form markup to keep accessible. Rejected for now, and worth a fresh look if field types grow |
| JSON Forms 3.8.0                                                     | Schema-driven                                                                                                              | Ajv needs `new Function`, which our CSP and Workers block. Errors aren't tied to fields. Rejected                                                                                                                                                                                                                                   |
| Nuxt UI 4.12.0 `UForm`                                               | Works with Zod                                                                                                             | Doesn't render from a schema. Brings Tailwind, `@nuxt/fonts` and `@nuxt/icon`, whose Iconify API fallback is on by default. Rejected                                                                                                                                                                                                |
| A ready-made builder interface (SurveyJS Creator, Vueform Builder)   | Saves building the builder                                                                                                 | Both are paid. Rejected                                                                                                                                                                                                                                                                                                             |
| Port mailflare's code (AGPL)                                         | Fastest route to features                                                                                                  | Puts the platform under the AGPL, which conflicts with S9                                                                                                                                                                                                                                                                           |
| Reimplement mailflare's features (chosen)                            | Keeps S9; built on our rules from the start                                                                                | More work                                                                                                                                                                                                                                                                                                                           |
| A hosted newsletter service                                          | Ready-made                                                                                                                 | A new processor, third-party tracking by default, and against S3                                                                                                                                                                                                                                                                    |

## Consequences

- **Easier:** a new role or form is an admin task, not a sprint. One table, one route, one hand-over and one deletion statement replace the per-form copies.
- **Harder:**
  - The engine must hold every rule that a reviewer used to check per form: P3 purpose, copy, accessibility, SG6. The publish checks are now security- and privacy-critical code and need their own tests.
  - Publishing a form changes the live site without a code release, so the audit log and the second approval matter.
- **Privacy:**
  - Area 5 keeps control through `purposes.ts`.
  - Two P3 rows are needed before their features ship: the suppression table, and newsletters with their contacts.
  - Mailboxes need a P3 row for each kind of role address.
- **Safeguarding:** the hand-over now covers every free-text form and every general mailbox. The safeguarding address is kept out of plain storage.
- **Security:**
  - New surface: the builder (admin text, rendered as text only), the mailbox HTML viewer, inbound attachments, the queue consumer and the `email()` handler.
  - Each of these needs the Security Reviewer.
- **Cost:**
  - Queues and Email Sending need the Workers Paid plan, which we already use.
  - R2 storage for mail is small at our volume.
- **Rules to update in the phase A PR:**
  - `terminology-and-copy.md` gains stored admin text.
  - `privacy.md` adds that every form and mailbox names a P3 purpose.
  - ADR-0006 is marked "partly superseded by ADR-0010" for templates and links. Its anti-abuse rules stay.
- **Open, for the founder through Rowan:**
  - which mail scope: mailboxes, newsletters, or both;
  - whether calendar and drive are wanted later;
  - whether the safeguarding address may forward to the safeguarding lead before M2c, or accepts into the encrypted store only;
  - how second approvals work while the founder holds every role: wait for a second person, or record a check done outside the platform in the audit log.

## Sources

Checked 28 October 2026:

- Email Service, receiving with the Workers `email()` handler and `postal-mime`: https://developers.cloudflare.com/email-service/api/route-emails/email-handler/
- Email Sending Workers API and send binding restrictions: https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ , https://developers.cloudflare.com/email-service/configuration/send-bindings/
- Suppressions (complaints, hard and soft bounces, scope): https://developers.cloudflare.com/email-service/concepts/suppressions/
- Email Sending event subscriptions through Queues: https://developers.cloudflare.com/email-service/reference/event-subscriptions/ , https://developers.cloudflare.com/email-service/examples/email-sending/sync-recipient-records/
- Email Service limits (inbound message size 25 MiB; suppression API limits): https://developers.cloudflare.com/email-service/platform/limits/
- Local testing of `email()` with Wrangler: https://developers.cloudflare.com/changelog/post/2025-04-08-local-development/
- RFC 8058, one-click unsubscribe: https://www.rfc-editor.org/rfc/rfc8058
