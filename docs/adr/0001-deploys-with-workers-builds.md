# ADR-0001: Deploy with Workers Builds and Worker Previews

- Status: proposed
- Date: 25 October 2026
- Author: Jun Okafor (DevOps Engineer)
- Ticket: #8

## Context

The handbook says staging deploys are automatic and live releases need Matt's approval. P5 says secrets are kept per environment and the repository is public. Handbook rule 2 says only made-up data is ever used outside live. The Kinmeet Cloudflare account (`0fa695ccf43f64b3eb9fae94520109b4`) is the only account we may deploy to.

We first proposed GitHub Actions with a Cloudflare API token held as a GitHub secret. On 25 October Matt and the Head of Delivery chose **Cloudflare Workers Builds** instead, so that no long-lived Cloudflare token is stored in GitHub, and asked for Cloudflare's **Worker Previews** to be used for every branch. GitHub Actions stays CI only.

Releases go through a protected `live` branch. Only organisation admins (Matt) can update it, under the `live` ruleset. A release is Matt merging `main` into `live`. `main` is protected by a ruleset that requires CI ("Type check, lint and unit tests") to pass before anything merges.

## Options for where Previews live

1. **One Worker.** Production is built from `live`. `main` and every pull request branch get a Preview under that same Worker, pointed at test bindings by its `previews` block. The Preview of `main` serves as staging.
2. **Two Workers (chosen).** `kinmeet-live` is built only from `live`, with Preview builds turned off. `kinmeet-staging` is built from `main`, and every other branch gets a Preview under `kinmeet-staging`.

|                                                  | One Worker                                                                 | Two Workers                                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| What stands between a pull request and live data | Only the `previews` block being right                                      | A different Worker whose own bindings are already test resources, plus the `previews` block |
| Code that ever runs next to live bindings        | Production builds from `live`, and Previews if the block is wrong          | Only builds from `live`, which Matt alone updates                                           |
| Staging                                          | The `main` Preview, sharing test resources with every pull request Preview | A persistent Worker with its own made-up data, separate from pull request Previews          |
| Setup                                            | One Workers Builds connection                                              | Two connections, both to the same repository                                                |
| Config                                           | Simpler `wrangler.jsonc`                                                   | `env.staging` and `env.live` in `wrangler.jsonc`                                            |

We chose two Workers because the safety of live data then does not depend on one block of config being correct. Pull request code never runs as part of the live Worker at all. The cost is one extra Workers Builds connection, set up once.

## Decision

- **`kinmeet-staging`** (Wrangler `env.staging`). Workers Builds production branch: `main`. Every push to `main` builds and deploys to https://kinmeet-staging.kinmeet.workers.dev with the staging D1, KV and R2.
- **Pull request Previews** under `kinmeet-staging`. Preview builds are on, with Preview command `bunx wrangler preview --env staging`. The `env.staging.previews` block points them at separate `kinmeet-preview` D1, KV and R2, so Previews never share data with staging, let alone live. Workers Builds posts each Preview URL on its pull request. `workers.dev` Preview URLs send `X-Robots-Tag: noindex`.
- **`kinmeet-live`** (Wrangler `env.live`). Workers Builds production branch: `live`. Preview builds are off. A merge of `main` into `live` by Matt deploys to https://kinmeet-live.kinmeet.workers.dev.
- **Build:** the dependency install Workers Builds does by default is switched off (`SKIP_DEPENDENCY_INSTALL=1`) and the build command is `bun install --frozen-lockfile && bun run build`, the same as CI. Workers Builds takes the Bun version from `packageManager` in `package.json` (`bun@1.4.4`).
- **Deploy commands:** `scripts/d1-migrate.sh <env> && bunx wrangler deploy --env <env>`, so D1 migrations are applied before the code that needs them.
- **Wrangler** is a project dev dependency at 4.135.0 or later (Worker Previews needs it; we are on 4.152.0). Nitro's `cloudflare.deployConfig` stays `false` in `nuxt.config.ts`, because Nitro turns it on inside Workers Builds and would otherwise replace our `wrangler.jsonc`.
- **All storage** is created with jurisdiction `eu`, which, unlike a location hint, is a guarantee and can only be set when the resource is created (P3).
- **After each deploy**, the `Check deployed site` workflow runs when the Workers Builds check run for `kinmeet-staging` on `main` or `kinmeet-live` on `live` completes. It loads the site from a GitHub runner and checks it returns 200 with the P5 security headers. The team's own sessions cannot reach `workers.dev`, so this is where those headers are verified.

## Consequences

- No Cloudflare token is stored in GitHub. Workers Builds uses a token that Cloudflare creates and holds for the account.
- Workers Builds deploys `main` on every push without waiting for GitHub CI. CI is still enforced, because the `main` ruleset will not let anything merge until CI passes. A direct push to `main` is blocked by the same ruleset.
- A release has no separate approval click: Matt's merge into `live` is the approval, and nobody else can make it.
- Matt sets up both Workers Builds connections once, in the dashboard (steps in `docs/deploys.md`). For a Worker that was connected to Builds before Worker Previews existed, Cloudflare asks for a one-time switch that cannot be undone. Ours are new, so they should start on Worker Previews; if the banner appears, the switch is what we want.
- The post-deploy check depends on the Workers Builds check run naming the Worker. We will confirm the name after the first build and adjust the workflow if needed.
- **Open:** D1 migrations for Previews. `wrangler d1 migrations apply` does not yet target the `previews` block, so pull request Previews will not get new tables automatically. This matters from Sprint 1, when the first migration lands; until then there are none.
- **Open:** put Previews and staging behind Cloudflare Access once forms or admin pages exist (P5).
- **Open:** run the no-third-party test (#6) against each pull request's Preview URL.
- Rollback: Matt reverts on `live`, or in the dashboard opens `kinmeet-live`, **Deployments**, and rolls back to the previous version.
