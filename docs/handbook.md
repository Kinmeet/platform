# Kinmeet platform team handbook

Version 1, 25 October 2026. Owner: Head of Delivery. Approved direction: the founder, 25 October 2026.

This is the shared starting point for every member of the team. Sprint 0 turned it into files inside the repository (`CLAUDE.md`, `.claude/`, `docs/`). **This repository copy is now the source of truth**; change it by pull request.

The planning documents linked below are private working documents held by the founder. They are listed so the team can find them; their adopted versions will be published under `docs/` in due course.

## 1. What we are building

The Kinmeet platform: one Nuxt app on Cloudflare Workers with D1, R2 and KV, for a UK volunteer-run network of local groups for the alterhuman community. Read these before any work (all decisions are made; do not reopen them):

- Services list and decisions S1-S9: https://claude.ai/artifact/6kK51ynrXJtZaKEffMMNfp
- P1 Phased build plan: https://claude.ai/artifact/MwU1PEgXvPtnGcTS1QGoaA
- P2 Platform architecture: https://claude.ai/artifact/EynYFZaQCQ5MQo9gPL7tY3
- P3 Data map and retention: https://claude.ai/artifact/VRt5BxUdaszEH7111x7h5h
- P4 Roles and access matrix: https://claude.ai/artifact/KCokjVz3PFo3XkvFbNJr6G
- P5 Security design: https://claude.ai/artifact/25Df4QMLXkKWAdPcRa5RqL
- P6 DPIA: https://claude.ai/artifact/6J92KFg1PVk7e8ELzLtnJE
- P7 Continuity and handover: https://claude.ai/artifact/1eHo8TRZfXBcSv9VVZ8y2m
- P8 Breach procedure: https://claude.ai/artifact/EhpmjHHfhxP7zzpKai9di4
- P9 Privacy notice: https://claude.ai/artifact/JW6cQEvzNkrqwfa13XdFXj
- P10 Organiser agreement: https://claude.ai/artifact/TbydDVZqC9RYjTCz13F5oF
- P11 Accessibility statement: https://claude.ai/artifact/Tgqpji7MvdAfkL5a5urzL5
- Pre-launch design (M1 pages): https://claude.ai/artifact/Mp2vrwDcbbRzRrG5pZwaDj
- Team plan: https://claude.ai/artifact/R4KUjPY1ncD3GFQBSJtvhQ

Docs links are read with the Claude Docs tools (or the Artifact tool's read action), never web-fetched.

## 2. Fixed facts

- Repository: https://github.com/Kinmeet/platform (public, "coding in the open", NOT open source; add a notice saying no reuse licence is granted).
- Cloudflare account: **Kinmeet, id `0fa695ccf43f64b3eb9fae94520109b4`. This is the ONLY account the team may touch.** The team's Cloudflare connection can see other, unrelated accounts. Never read from or write to them. Always pass `account_id` explicitly.
- workers.dev subdomain: `kinmeet` (so Workers are served at `<worker-name>.kinmeet.workers.dev`). No custom domain yet.
- Package manager and script runner: **Bun** (the founder, 25 October 2026). No npm or package-lock.json.
- Discord bot: out of scope. The founder builds it. We only specify the API it will call.
- Out of scope until later milestones: anything in P1 Phase 3 and 4.

## 3. Firm rules (non-negotiable)

1. No tracking, analytics or third-party requests on any page. The only exception is Cloudflare Turnstile on form pages (S5). A CI test enforces this.
2. No personal data or secrets in the repository, issues, PR text, test fixtures or logs. Test data is made up and obviously fake.
3. Organisers and trustees appear publicly only by role title and community name.
4. Terminology in all user-facing text: "all-ages" (never SFW/NSFW), "local group" or "group" (never chapter), "meet" (never moot), never name or compare other communities. British English everywhere, code comments included.
5. Encrypted areas (safeguarding, password vault) are never readable by the server or the developer (P5). Nothing in M2c goes live with real data before the human outside security review.
6. Live releases need the founder's approval. Staging deploys are automatic.
7. Decisions in the F, SG, S and P documents are followed. A conflict found while building goes to the Head of Delivery as a question, not a silent change.
8. Never skip, disable or weaken a test to get green.

**Update, 26 October 2026 (the founder's decisions on #36 and #95):** until the M2c sunset, handed-over disclosures are kept in the `safeguarding_items` table of the main D1, encrypted in the Worker with a key held as the `SAFEGUARDING_KEY` secret. This is a recorded exception to rule 5, because live code can decrypt them. Agents never query, change or export that table on a real database, and never see, set or rotate the live key, which only the founder holds. Before the first public form opens, the agents' Cloudflare access becomes read-only for Workers, Workers Builds, Access and D1 (go-live condition 6), so only reviewed code reaching the founder's `live` branch can run on live. A Time Travel restore of a live database is founder-only, because it also changes the safeguarding records. See [the safeguarding data rule](../.claude/rules/safeguarding-data.md).

## 4. Team structure

**Update, 25 October 2026 (the founder):** every team member is a named persona with their own working session. See [personas.md](personas.md) for names, handles, roles, reporting lines and attribution rules. Builders and reviewers are now personas that sit idle until assigned, rather than one-off subagents (personas may still use subagents for parallel chunks). Where this section says "hire", read "assign to the persona".

- **The founder** (product owner): approves plans, milestone reviews and live releases.
- **Coordinator**: project overview, links to non-platform areas (safeguarding, privacy, volunteers), starts new working sessions.
- **Head of Delivery**: roadmap, sprint planning across squads, cross-squad decisions, reports to the founder, owns the Discord bot API spec.
- **Squads**, each led by an **Engineering Manager (EM)**. The EM plans the squad's sprint, breaks it into tickets, hires builder and reviewer agents for each ticket, reviews and merges, and reports to the Head of Delivery.
  - **Platform squad**: repository, tooling, CI/CD, environments, the team's own skills/rules/hooks, test harness, D1/R2/KV provisioning, deploys. Includes the tech lead (architecture decision records, conventions, final review).
  - **Web squad**: public pages and components, forms UI, content, translation-ready text, accessibility.
  - **Services squad**: server routes, forms API, Turnstile verification, email sending (S3), admin page behind Cloudflare Access, retention and deletion jobs.
  - Later squads (started when their milestone begins): **Identity** (M2a), **Safety** (M2b-c, includes the cryptography engineer), **Business** (M3).
- **Quality guild** (cross-squad roles, hired per pull request by EMs using shared guild skills): test engineer, security reviewer, privacy and safeguarding reviewer, accessibility reviewer. A reviewer never reviews work it wrote.
- **Research scout**: hired at the start of each sprint to check current versions and documentation for what the sprint uses; writes findings to `docs/research/`.

## 5. Sprints and ceremonies

- A sprint is a scoped batch with one goal, not a calendar week. Each sprint has a file `docs/sprints/sprint-N.md`: goal, tickets, owners, definition of done, risks.
- **Planning**: the Head of Delivery sets the sprint goal per squad; each EM writes its tickets as GitHub issues (label by squad and sprint).
- **Stand-up**: each EM posts a short status to the Head of Delivery when a ticket merges or is blocked (not on a timer).
- **Review**: at the end of each milestone, a demo on staging for the founder.
- **Retro**: each EM adds what went well and what to change to the sprint file; agreed changes go into rules, skills or hooks.

## 6. Definition of done (every ticket)

- Code, tests and docs in one PR on a branch `<squad>/<issue-number>-<slug>`, linked to its issue.
- CI green: type check, lint, unit and integration tests, end-to-end browser tests, accessibility scan, the no-third-party-requests test.
- Reviewed by the squad's tech-lead review and, where relevant, security, privacy and accessibility reviewers; every comment answered.
- Existing modules checked before building: nuxt.com/modules, the Nuxt and Nitro docs, and current maintained packages. The PR description names what was adopted, or why each candidate was rejected (`.claude/rules/existing-modules.md`).
- Decision record added for any non-obvious technical choice (`docs/adr/`).
- Deployed to staging by the merge.

## 7. Sprint plan (first three sprints)

- **Sprint 0 (Platform squad only)**: repository and team scaffolding, Nuxt on Workers, staging and live Workers on kinmeet.workers.dev, CI/CD, no-third-party test, security headers, test harness, the team's skills/rules/hooks. Exit: an empty Kinmeet page on staging, CI green, handbook in the repo.
- **Sprint 1 (Web and Services squads, Platform supporting)**: M1 pre-launch site per P1 Phase 1.
- **Sprint 2**: M1 hardening, privacy notice and accessibility statement pages, the founder's M1 review.

## 8. Standing go-ahead from the founder (28 October 2026)

The founder has given a standing go-ahead for **anything non-destructive**, and for destructive actions that **undo a temporary test** (for example deleting a probe branch, a throwaway Preview or made-up test data). When a session's permission check asks, quote this go-ahead.

These still need the founder each time:

- other destructive actions;
- releases to `live`;
- the safeguarding key;
- adding personal addresses to Access policies.

The go-ahead does not change the firm rules, the hooks or the safeguarding data rule. Record what you did on the ticket.
