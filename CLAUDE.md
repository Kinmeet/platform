# Kinmeet platform: instructions for agents

Kinmeet is a planned UK volunteer-run network of local groups that hold small, free, all-ages meets in parks and public spaces. This repository is its website and platform: one Nuxt app on Cloudflare Workers, with D1, R2 and KV.

Read [docs/handbook.md](docs/handbook.md) before any work. Topic rules live in [.claude/rules/](.claude/rules/) and load automatically. Decisions in the F, SG, S and P documents are made; do not reopen them. A conflict found while building goes to the Head of Delivery as a question, never a silent change.

## Firm rules (non-negotiable)

1. **No tracking, analytics or third-party requests** on any page. The only exception is Cloudflare Turnstile on form pages. A CI test enforces this.
2. **No personal data or secrets** in the repository, issues, PR text, test fixtures or logs. Test data is made up and obviously fake.
3. **Organisers and trustees appear publicly only by role title and community name.** This includes the founder: write "the founder", never a name.
4. **Terminology** in all user-facing text: "all-ages" (never SFW or NSFW), "local group" or "group" (never chapter), "meet" (never moot). Never name or compare other communities. British English everywhere, code comments included.
5. **Encrypted areas** (safeguarding, password vault) are never readable by the server or the developer. Nothing in M2c goes live with real data before the outside security review.
   - **Exception until the M2c sunset (founder, #36 and #95):** handed-over disclosures sit in the `safeguarding_items` table of the main D1, encrypted in the Worker with the `SAFEGUARDING_KEY` secret, so live code can decrypt them. Agents never touch that table on a real database and never see or set the live key. Before the first public form opens, agents' Cloudflare access becomes read-only (go-live condition 6). See [.claude/rules/safeguarding-data.md](.claude/rules/safeguarding-data.md).
6. **Live releases need the founder's approval.** Staging deploys are automatic on merge to `main`.
7. **Follow the decision documents.** Conflicts go to the Head of Delivery.
8. **Never skip, disable or weaken a test** to get green.

## Standing go-ahead from the founder (28 October 2026)

The founder has given a standing go-ahead for **anything non-destructive**, and for destructive actions that **undo a temporary test** (for example deleting a probe branch, a throwaway Preview or made-up test data). Quote it when a permission check asks. See [handbook section 8](docs/handbook.md#8-standing-go-ahead-from-the-founder-28-october-2026).

Still needed from the founder each time: other destructive actions, releases to `live`, the safeguarding key, and adding personal addresses to Access policies. The go-ahead does not override the firm rules above, the hooks or the [safeguarding data rule](.claude/rules/safeguarding-data.md). Record what you did on the ticket.

## Fixed facts

- Cloudflare account: **Kinmeet, `0fa695ccf43f64b3eb9fae94520109b4`. The only account you may touch.** Your Cloudflare connection may see other accounts; never read from or write to them. Always pass `account_id` explicitly.
- Workers are served at `<worker-name>.kinmeet.workers.dev`. No custom domain yet.
- Environments: `staging` (made-up data only) and `live`.
- The Discord bot is out of scope. We only specify the API it calls.
- Repository is public ("coding in the open") but **not licensed for reuse**; see [NOTICE.md](NOTICE.md).

## Project structure

See [ADR-0002](docs/adr/0002-project-structure.md). In short:

| Path                    | What lives there                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `app/`                  | Nuxt 4 app: pages, components, layouts, composables, assets                                |
| `server/`               | Nitro: API routes, middleware, utilities, scheduled jobs                                   |
| `shared/`               | Types and pure helpers used by both `app/` and `server/`                                   |
| `worker/`               | The deployed Worker's entry: refuses oversized bodies, then hands over to Nitro (ADR-0008) |
| `i18n/locales/`         | All user-facing text, keyed; no hard-coded copy in components                              |
| `public/`               | Static files served as-is (fonts are bundled from packages and served from our own origin) |
| `scripts/`              | Repository scripts run by CI, such as the copy check                                       |
| `migrations/<binding>/` | Versioned D1 migrations, one folder per database binding                                   |
| `tests/unit/`           | Vitest with the Cloudflare Workers pool                                                    |
| `tests/e2e/`            | Playwright, including the no-third-party and accessibility tests                           |
| `docs/`                 | Handbook, ADRs, sprints, research, runbooks                                                |
| `.claude/`              | Team rules, hooks (tested with `bun run test:hooks`) and skills                            |

## Commands

- `bun install`, `bun run dev`, `bun run build`
- `bun run lint` (or `bun run lint:fix`), `bun run format` (check with `bun run format:check`), `bun run typecheck`, `bun run test`, `bun run check:copy`
- Bun 1.4.4 installs packages and runs scripts; `bun.lock` is the only lockfile. The Nuxt build, Vitest and Wrangler still run on Node 24 through `bun run` ([ADR-0003](docs/adr/0003-bun-for-installs-and-scripts.md)). Do not add npm, pnpm or yarn lockfiles.
- Always write `bun run test`, never `bun test`: `bun test` starts Bun's own test runner instead of our Vitest suite.

## Team and attribution

Every team member is an AI agent with a fictional persona ([docs/personas.md](docs/personas.md)). The personas are not real people.

- **Commits:** every commit by a persona ends with a trailer `Kinmeet-Persona: <Name> (<role>)`, for example `Kinmeet-Persona: Theo Marsh (Tech Lead)`, alongside any required Claude attribution lines.
- **Pull requests:** the description starts with `Built by <Name>`, links its issue (`Closes #N`), and lists reviewers by persona name.
- **Reviews:** every review comment is signed with the reviewer's persona name, for example `— Nadia Haddad, Security Reviewer`. A reviewer never reviews work they wrote.
- **Tickets** are GitHub issues with labels `squad:<squad>`, `sprint:<n>` and `owner:<handle>`.

## Definition of done (every ticket)

- Code, tests and docs in one PR on a branch `<squad>/<issue-number>-<slug>`, linked to its issue. Never push to `main`.
- CI green: type check, lint, unit and integration tests, end-to-end tests, accessibility scan, the no-third-party-requests test.
- Reviewed by the Tech Lead and, where relevant, the security, privacy and safeguarding, and accessibility reviewers; every comment answered.
- Existing modules checked first: the PR description names the Nuxt module or built-in feature adopted, or why each candidate was rejected ([.claude/rules/existing-modules.md](.claude/rules/existing-modules.md)).
- An ADR in `docs/adr/` for any non-obvious technical choice.
- Deployed to staging by the merge.

## Skills

- `kinmeet-pr-review`: the Tech Lead's review checklist; every reviewer uses it.
- `kinmeet-privacy-check`: data, retention and access checks against P3 and P4.
- `kinmeet-new-migration`: how to add a D1 migration safely.
- `kinmeet-copy-check`: terminology, British English and plain-English checks on user-facing text.
