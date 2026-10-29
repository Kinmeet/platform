---
name: kinmeet-pr-review
description: Review a Kinmeet pull request against the handbook, firm rules and definition of done. Use for every PR review, whether as Tech Lead (final review) or as a quality guild reviewer.
---

# Kinmeet PR review

You are reviewing as a named persona. Sign every comment with your persona name and role, for example `— Theo Marsh, Tech Lead`. Never review a PR you wrote or co-wrote.

## 1. Read before judging

- The PR description, its linked issue and the issue's acceptance criteria.
- The full diff (`gh pr diff <n>` or the GitHub tools), not only the summary.
- `CLAUDE.md`, the rules in `.claude/rules/`, and any ADR the change relies on.
- CI results. Do not approve while checks are red or pending.

## 2. Checklist

Work through every section. Note "n/a" rather than skipping silently.

**Scope and structure**

- Does the PR do what the issue asks, and nothing unrelated?
- Branch is `<squad>/<issue>-<slug>`; description starts `Built by <Name>`, has `Closes #N`, lists reviewers by persona.
- Commits carry the `Kinmeet-Persona:` trailer.
- Files sit where ADR-0002 says they belong.

**Existing modules**

- Does the PR build something a Nuxt module, a Nuxt or Nitro built-in, or a maintained package already does? Check nuxt.com/modules and the docs yourself; do not rely only on the description.
- The description has an "Existing modules checked" section naming what was adopted, or why each candidate was rejected (third-party requests, not Workers-compatible, unmaintained, too heavy, conflicts with a decision). Missing or unconvincing is **Must fix**.
- A module adopted is a new dependency: pinned in `bun.lock`, with a reason given, and passes the firm rules.

**Firm rules**

- No new third-party request, script, font, image or CDN link. Turnstile only on routes marked as form pages.
- No personal data or secrets in code, fixtures, comments, logs or PR text. Test data is obviously fake.
- People in roles shown only by role title and community name.
- Read the first lines of the PR description, where the attribution block sits. A "Requested by" line, or any other line there, that names a person is **Must fix**: ask for "Requested by the founder". The PR description check catches the usual form, but read it yourself too.
- No test skipped, disabled, loosened or deleted.
- Nothing deploys to live outside a tagged, approved release.

**Correctness and design**

- Logic is right for edge cases: empty input, duplicates, time zones (UK), retries, partial failures.
- Server validates every input; SQL uses bound parameters.
- Errors are handled and logged without personal data.
- The simplest design that works; no speculative abstraction. A non-obvious choice has an ADR.
- Types are strict; no `any` or non-null assertions without a comment saying why.

**Tests**

- New behaviour has tests; a bug fix has a test that failed before.
- Denied cases are tested for role checks.
- New routes are covered by the no-third-party and accessibility tests.
- Personal-data tables have retention tests.

**Docs and copy**

- README, runbooks or `docs/` updated where behaviour or operations changed.
- User-facing text passes `kinmeet-copy-check`.
- Personal data changes pass `kinmeet-privacy-check`.

**Hand-offs**

- Touches sign-in, sessions, roles, headers, crypto, uploads or secrets: Security Reviewer requested.
- Touches personal data, retention, safeguarding or user-facing policy text: Privacy and Safeguarding Reviewer requested.
- Touches a page, component or form: Accessibility Reviewer requested.

## 3. Write the review

- Lead with a verdict: **Approve**, **Approve with nits**, or **Changes requested**.
- Group findings as **Must fix** (blocks merge), **Should fix** (fix now or open an issue), **Nit** (optional).
- Each finding names the file and line, what is wrong, why it matters, and a concrete fix.
- Be specific and kind. Praise what is done well in one line.
- End with your signature. If you are the Tech Lead giving final review, say whether the PR is ready for the EM to merge.
