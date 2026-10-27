# ADR-0001: Deploy with Workers Builds and Worker Previews

- Status: proposed
- Date: 25 October 2026, revised 27 October 2026 (one Worker, #115)
- Author: Jun Okafor (DevOps Engineer)
- Tickets: #8, #115

## Context

The handbook says staging deploys are automatic and live releases need the founder's approval. P5 says secrets are kept per environment and the repository is public. Handbook rule 2 says only made-up data is ever used outside live. The Kinmeet Cloudflare account (`0fa695ccf43f64b3eb9fae94520109b4`) is the only account we may deploy to.

We first proposed GitHub Actions with a Cloudflare API token held as a GitHub secret. On 25 October the founder and the Head of Delivery chose **Cloudflare Workers Builds** instead, so that no long-lived Cloudflare token is stored in GitHub, and asked for Cloudflare's **Worker Previews** to be used for every branch. GitHub Actions stays CI only.

Releases go through a protected `live` branch. Only organisation admins (the founder) can update it, under the `live` ruleset. A release is the founder merging `main` into `live`. `main` is protected by a ruleset that requires CI to pass before anything merges.

The first version of this ADR chose two Workers (a staging Worker built from `main` with Previews for other branches, and a live Worker built from `live`), and they were set up as `platform-staging` and `platform-live`. On 27 October the founder chose to collapse them into **one Worker, `platform`, using Previews**, because the two-Worker setup was more involved than it needed to be.

## Options for where Previews live

1. **One Worker (chosen by the founder, 27 October).** Production is built from `live`. `main` and every other branch get a Preview under the same Worker, pointed at test resources by its `previews` block. The Preview of `main` serves as staging.
2. **Two Workers (the first choice, now replaced).** A live Worker built only from `live`, with Preview builds off, and a staging Worker built from `main`, with Previews for every other branch.

|                                             | One Worker                                                                                        | Two Workers                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| What stands between a branch and live data  | The `previews` block pointing at test resources (a test and review guard it, see Consequences)    | A different Worker whose own bindings are test resources, plus the `previews` block |
| What a build token for Previews can also do | Deploy production and change production secrets: Cloudflare has no Preview-only permission        | Could have been scoped to the staging Worker only (the founder deferred this)       |
| Staging                                     | The `main` Preview, sharing the Preview resources with every branch Preview                       | A persistent Worker with its own made-up data, separate from branch Previews        |
| Scheduled jobs (the daily deletion job)     | Run on production only: Cloudflare does not run Cron Triggers for Previews                        | Ran on staging and live                                                             |
| Setup                                       | One Workers Builds connection, one Access app for Previews, one set of production paths in Access | Two connections, two sets of Access apps                                            |
| Config                                      | One environment with a `previews` block                                                           | `env.staging` with `previews`, and `env.live`                                       |

## Decision

- **One Worker, `platform`**, connected to Workers Builds. Wrangler config: `env.live` holds production (live) settings, and its `previews` block holds the Preview settings. The top level of `wrangler.jsonc` stays local-only, so `wrangler dev` and the unit tests never see a real resource.
- **Production:** Workers Builds production branch `live`. A merge of `main` into `live` by the founder deploys to https://platform.kinmeet.workers.dev with the live D1, KV and R2. Deploy command: `scripts/d1-migrate.sh live && bunx wrangler deploy --env live`.
- **Previews:** Preview builds are on for every other branch, with Preview command `scripts/d1-migrate.sh preview && npx wrangler preview --env live`. Each branch gets `<branch>-platform.kinmeet.workers.dev`. The Preview of `main` is staging: https://main-platform.kinmeet.workers.dev. Workers Builds posts each Preview URL on its pull request. `workers.dev` Preview URLs send `X-Robots-Tag: noindex`.
- **Preview resources:** every Preview shares one set of made-up-data resources. We reuse the existing staging D1, KV and R2 (`kinmeet-staging`), which already have every migration applied. The `kinmeet-preview` resources are retired once the new Worker is verified.
- **Preview migrations:** `scripts/d1-migrate.sh preview` applies migrations to the shared Preview database through a separate `wrangler.preview-migrations.jsonc`, as Cloudflare's Previews documentation describes, **only for builds of `main`** (`WORKERS_CI_BRANCH`). A branch that adds a migration therefore runs on `main`'s schema until it merges. Otherwise an unmerged or abandoned migration would change the database every other Preview shares.
- **Secrets:** production secrets are set on the Worker by the founder. Preview secrets go in the **Previews Base** configuration, which every new Preview starts with. They are different values from production, and the Preview safeguarding key is generated inside the Cloudflare runtime, so no agent sees it (`.claude/rules/safeguarding-data.md`).
- **Access:** one Access application covers every Preview of `platform` (destination type `preview_worker`), with the `Kinmeet admins` policy. Production's `/admin`, `/api/admin`, `/safeguarding` and `/api/safeguarding` paths on `platform.kinmeet.workers.dev` get their own applications, as before.
- **Build:** the dependency install Workers Builds does by default is switched off (`SKIP_DEPENDENCY_INSTALL=1`) and the build command is `bun install --frozen-lockfile && bun run build`, the same as CI. Workers Builds takes the Bun version from `packageManager` in `package.json` (`bun@1.4.4`).
- **Wrangler** is a project dev dependency at 4.135.0 or later (Worker Previews needs it; we are on 4.152.0).
- **All storage** is created with jurisdiction `eu`, which, unlike a location hint, is a guarantee and can only be set when the resource is created (P3).
- **After each deploy**, the `Check deployed site` workflow runs when the Workers Builds check run for `platform` completes on `main` or `live`. It loads the matching URL from a GitHub runner and checks it returns 200 with the P5 security headers.

## Consequences

- No Cloudflare token is stored in GitHub. Workers Builds uses a token that Cloudflare creates and holds for the account.
- Workers Builds builds a Preview of `main` on every push without waiting for GitHub CI. CI is still enforced, because the `main` ruleset will not let anything merge until CI passes.
- A release has no separate approval click: the founder's merge into `live` is the approval, and nobody else can make it.
- **Security (for the Security Reviewer):** every Preview build, from any branch, runs with the Worker's build token. That token needs Workers write on `platform` to create Previews, and Cloudflare has no permission that allows Previews but not production deploys or production secrets (the Previews API needs `Workers Scripts Write`). So code on any branch could, in principle, deploy production or replace a production secret, including the live safeguarding key. With two Workers the same risk existed through the account-wide staging token (#95), and the founder deferred it. With one Worker it can no longer be narrowed by scoping a token to one Worker. This is a residual risk to record in the interim safeguarding exception and go-live condition 6. Review of every change, and the founder-only `live` branch, remain the controls.
- **The `previews` block must never point at a live resource.** A unit test in the config PR fails if any binding in `env.live.previews` names a live database, namespace or bucket, and the Bash and Cloudflare hooks keep refusing remote commands on live databases (#111).
- **Scheduled jobs** run only on production. The daily deletion job is still tested end to end in CI through `/__scheduled` (#101), but it no longer runs against staging data.
- Rate limiters on Previews keep their own `namespace_id`s, so Previews never share counters with production.
- The founder sets up the one Workers Builds connection in the dashboard (steps in `docs/deploys.md`). The old Workers are deleted only after a Preview of `main` and a live build have both been verified.
- Rollback: the founder reverts on `live`, or in the dashboard opens `platform`, **Deployments**, and rolls back to the previous version.
- ADR-0009 (NuxtHub) builds one environment chosen by `CLOUDFLARE_ENV`. With one Worker, both production and Preview builds use `CLOUDFLARE_ENV=live`, which carries the `previews` block. The build check accepts `live` only.
- **Open:** run the no-third-party test (#6) against each pull request's Preview URL.

## Sources

Checked 27 October 2026:

- Cloudflare Worker Previews: configuration, resources and isolation, limits (100 Previews per Worker and 100 deployments per Preview on Free; the oldest are removed automatically).
- Workers Builds: build branches, Preview command, default build variables (`WORKERS_CI_BRANCH`), triggers.
- The Cloudflare API description of the Previews endpoints, which accept `Workers Scripts Write` only.
