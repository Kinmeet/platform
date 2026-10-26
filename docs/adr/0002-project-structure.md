# ADR-0002: Project structure

- **Status:** Accepted
- **Date:** 25 October 2026
- **Author:** Theo Marsh (Tech Lead)
- **Reviewers:** Priya Nandakumar (Engineering Manager, Platform)
- **Related:** issues #2, #3 and #9; S1, S9; P2 Platform architecture; P5 Security design; P7 Continuity and handover

## Context

The platform is one Nuxt app on Cloudflare Workers (S1, P2), built in the open (S9) by a team of agents and later handed to a volunteer maintainer (P7). The layout must be predictable so that any team member, reviewer or successor knows where a file belongs without asking, and so that tooling (tests, the no-third-party check, migrations) can rely on fixed paths.

P2 suggested `app/`, `server/`, `content/`, `migrations/` and `docs/`. Nuxt 4 makes `app/` the default source directory and adds `shared/` for code used on both sides. P2 also keeps safeguarding and password-vault data in their own D1 databases, so migrations must be able to target more than one database.

## Decision

Use the standard Nuxt 4 layout with as few additions as possible:

```text
app/                    Nuxt app (browser and server-rendered views)
  pages/                File-based routes
  components/           Vue components
  layouts/              Page layouts
  composables/          Reusable composition functions
  assets/               Styles and assets processed by the build
  app.vue
server/                 Nitro (runs on the Worker)
  api/                  JSON API routes (/api/...)
  routes/               Non-API server routes (for example feeds)
  middleware/           Request middleware, including security headers
  utils/                Server-only helpers (auto-imported)
  tasks/                Scheduled jobs (retention, backups), when added
shared/                 Types and pure functions used by app/ and server/
i18n/
  locales/              All user-facing text, one file per locale (en-GB first)
content/                Published policies (Nuxt Content), from M1
public/                 Static files served as-is
scripts/                Repository scripts run by CI (for example check-copy.ts)
migrations/
  <binding>/            One folder per D1 binding, numbered SQL files
tests/
  unit/                 Vitest with @cloudflare/vitest-pool-workers
  e2e/                  Playwright, including no-third-party and axe scans
docs/
  handbook.md           Team handbook (source of truth)
  personas.md           Team personas
  adr/                  Decision records
  research/             Version and documentation checks per sprint
  sprints/              Sprint plans and retros
  runbooks/             Operational procedures (P7)
.claude/                Team rules, hooks and skills for agents
.github/                Workflows, issue and PR templates
wrangler.jsonc          Worker config with staging and live environments
nuxt.config.ts
```

Conventions that go with the layout:

- **Server code stays in `server/`.** Nothing in `app/` talks to D1, R2 or KV directly; it calls the server.
- **`shared/` holds no secrets and no server-only imports**, because it can be bundled into the browser.
- **No hard-coded copy in `app/`.** Text lives in `i18n/locales/` so the site is translation-ready from the start.
- **One D1 binding per database, one migrations folder per binding.** The main database starts as `migrations/db/`. Safeguarding and vault databases get their own folders when M2c begins. Each binding's `migrations_dir` in the `wrangler` config points at its folder.
- **Tests mirror the source path:** `server/utils/headers.ts` is tested in `tests/unit/server/utils/headers.test.ts`.
- **Scheduled jobs start in `server/tasks/`.** P2 suggests separate small Workers for jobs so a slow job never affects the site; if we split them out, that is a new ADR and they go in `workers/<name>/`.
- **Bun** is the package manager and script runner ([ADR-0003](0003-bun-for-installs-and-scripts.md)). Scripts are run with `bun run <script>`.
- **Repository scripts** (for example the copy check) live in `scripts/`.

## Options considered

| Option                                                                             | For                                                                                        | Against                                                         |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Standard Nuxt 4 layout with `shared/`, `i18n/`, per-binding `migrations/` (chosen) | Matches Nuxt and Wrangler defaults and their documentation; least to learn for a successor | Root has many folders                                           |
| Monorepo with separate packages for web, API and jobs                              | Clear boundaries                                                                           | More tooling and config to maintain; P2 chose one app           |
| Nuxt 3 style layout without `app/`                                                 | Familiar to some                                                                           | Not the Nuxt 4 default; would need extra config                 |
| One migrations folder for all databases                                            | Simpler at first                                                                           | Cannot target separate safeguarding and vault databases cleanly |

## Consequences

- New files have an obvious home, which keeps reviews short and handover easier (P7).
- Tests and CI can rely on fixed paths: `tests/unit`, `tests/e2e`, `i18n/locales`, `migrations/<binding>`.
- Adding a database means adding a binding, a migrations folder and an ADR.
- If Nuxt's defaults change in a future major version, we follow the defaults and record the change in a new ADR.

## Sources

- Nuxt 4 directory structure: https://nuxt.com/docs/4.x/guide/directory-structure (checked 25 October 2026)
- Wrangler D1 migrations and `migrations_dir`: https://developers.cloudflare.com/d1/reference/migrations/ (checked 25 October 2026)
- Sprint 0 research notes: [docs/research/sprint-0.md](../research/sprint-0.md)
