---
name: kinmeet-privacy-check
description: Check a change that collects, stores, shows, logs or deletes personal data against the Kinmeet data map (P3), access matrix (P4), privacy notice (P9) and safeguarding decisions. Use when a PR adds a form field, table, column, log line, email, export or page that shows people.
---

# Kinmeet privacy check

Kinmeet's members are mostly young and part of a community that can be targeted. The safest data is data we never collect.

## 1. List the personal data

For every piece of personal data the change touches, write down: what it is, whose it is, where it is stored (D1 database and table, R2, KV, logs, email), who can read it, and when it is deleted.

## 2. Check each item

- **In P3?** It matches a row of the data map. If not, stop: adding a new kind of personal data is a decision for the Head of Delivery and area 5, not the builder.
- **Minimal?** Could we do without it, ask for less (community name instead of legal name, age band instead of date of birth), or keep it for less time?
- **Never stored:** IP addresses with form submissions, analytics, copies of DBS certificates, survey answers linked to people. Not even "temporarily".
- **Never sent out:** no `remoteip` to Turnstile siteverify, no personal data to any outside service.
- **Retention:** the table has the timestamp the deletion job needs, the job covers it, and a test proves rows go at the end of the P3 period. Every row gets a deletion date when stored, with a backstop if the P3 trigger (a reply, a decision) never happens.
- **Access (P4):** the server checks the role on every read and write. A test covers a denied case. Sensitive reads and changes write to the audit log.
- **Encryption level (P5):** safeguarding reports, case records and the vault are encrypted in the browser; volunteer records, DBS outcomes and consent details use encrypted fields; nothing sensitive sits in plain columns.
- **Logs and errors:** no names, emails, messages, tokens or free text in Workers Logs or error messages, and observability keeps no request headers (`CF-Connecting-IP`, `User-Agent`) or bodies. Codes and ids only.
- **Public display:** anywhere public (pages, the repository, issues, PRs, commits), organisers, trustees and the founder by role title and community name only. No faces, legal names, addresses or exact home areas.
- **Under-18s:** follow SG1 (under-16s with a parent or carer; 16 to 17 alone with consent) and SG2 (Discord 13+). Under-13s on forms or mailing lists follow area 5's rule; if none exists yet, raise a question.
- **Safeguarding (SG6):** any free-text route (forms, messages, comments) needs a way to pass a disclosure to the safeguarding lead and remove the general copy; safeguarding items are visible to the lead and deputy only; adults in roles never message under-18s one to one about Kinmeet (SG2).
- **Privacy notice (P9):** does the notice already describe this use? If not, the PR must say so and the Privacy and Safeguarding Reviewer flags it.
- **Fixtures:** test data is obviously fake (`example.com`, "Test Organiser").
- **Third parties:** no new processor. Cloudflare is the only one in Phase 1.

## 3. Report

Write a short table: item, P3 row, retention, access, verdict (OK, fix, question). Then list **Must fix** items and **Questions for the Head of Delivery**. Sign with your persona name.
