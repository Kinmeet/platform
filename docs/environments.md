# Environments

Every resource is in the Kinmeet Cloudflare account (`0fa695ccf43f64b3eb9fae94520109b4`) and was created with **jurisdiction `eu`**, so its data is guaranteed to stay in the EU (P3). A location hint is only best effort and the jurisdiction can only be set when a resource is created, so a resource without it must be recreated, not changed.

Resource ids are not secrets. They live in [`wrangler.jsonc`](../wrangler.jsonc). How each environment is built and deployed is in [deploys.md](deploys.md) and [ADR-0001](adr/0001-deploys-with-workers-builds.md).

| Environment                 | Wrangler               | Worker                          | Built from                          | D1 (`DB`)         | KV (`KV`)         | R2 (`R2`)         | Data    |
| --------------------------- | ---------------------- | ------------------------------- | ----------------------------------- | ----------------- | ----------------- | ----------------- | ------- |
| Local                       | top level              | `kinmeet-local`, never deployed | your machine                        | simulated         | simulated         | simulated         | made-up |
| Previews, including staging | `env.live.previews`    | Previews of `platform`          | every branch except `live`          | `kinmeet-staging` | `kinmeet-staging` | `kinmeet-staging` | made-up |
| Live                        | `env.live`             | `platform` (production)         | `live` (the founder only)           | `kinmeet-live`    | `kinmeet-live`    | `kinmeet-live`    | real    |
| Old staging (until step 6)  | `env.staging`          | `platform-staging`              | `main`                              | `kinmeet-staging` | `kinmeet-staging` | `kinmeet-staging` | made-up |
| Old Previews (until step 6) | `env.staging.previews` | Previews of `platform-staging`  | any branch except `main` and `live` | `kinmeet-preview` | `kinmeet-preview` | `kinmeet-preview` | made-up |

The Preview of `main` is staging: https://main-platform.kinmeet.workers.dev. Every Preview shares the `kinmeet-staging` resources, which have only ever held made-up data (on 27 October 2026 its `hello_messages`, `applications` and `email_log` tables were empty). The two "old" rows go when the founder retires the old Workers ([deploys.md](deploys.md), step 6); a follow-up removes `env.staging` and the `kinmeet-preview` resources then.

`KINMEET_ENV` is set to `preview` or `live` (and `staging` on the old staging Worker) so the app can tell where it is running.

`APPLY_ROUND_CLOSES_AT` (optional) is when the founding round closes, in Unix-epoch seconds. Applications that never reach a decision are deleted 6 months after that date, or 6 months after receipt if that is later (P3). Until it is set, the backstop is 6 months after receipt.

## Ids

| Resource             | Id                                     |
| -------------------- | -------------------------------------- |
| D1 `kinmeet-staging` | `18c80f5f-3c72-4781-8d38-98ef6cc4a096` |
| D1 `kinmeet-preview` | `74454f75-8b40-44d7-ac02-e6145d9e8ff6` |
| D1 `kinmeet-live`    | `3b253758-831e-4db9-bb90-fb4598f215db` |
| KV `kinmeet-staging` | `5a9d7b8c548a4c3a8d596eec650a474b`     |
| KV `kinmeet-preview` | `87dfe82d807e49cf945334fbd17d7b26`     |
| KV `kinmeet-live`    | `90bba5907a604bc49aead31e93c939fc`     |

R2 buckets are named, not numbered: `kinmeet-staging`, `kinmeet-preview` and `kinmeet-live`. The founder creates them in the dashboard with jurisdiction EU (step 1 of the one-time setup in [deploys.md](deploys.md)), because the team's API connection cannot set an R2 jurisdiction. Deploys fail until they exist.

## Other bindings

- `FORM_RATE_LIMITER` (5 per 60 seconds) and `FORM_GLOBAL_RATE_LIMITER` (100 per 60 seconds, to be tuned by Services). Counts are per Cloudflare location. Each environment has its own `namespace_id` (local 100x, old staging 110x, old Previews 120x, live 130x, Previews of `platform` 140x), because limiters with the same id share counters across Workers.
- D1 migrations live in `migrations/db/`. Live is migrated by its deploy command, `scripts/d1-migrate.sh live`. The shared Preview database is migrated by `scripts/d1-migrate.sh preview` through `wrangler.preview-migrations.jsonc`, only in builds of `main` ([Previews, D1 migrations](https://developers.cloudflare.com/workers/previews/resources/#d1-migrations)).

## Secrets

Secrets are never in the repository. Each environment needs its own values, set by the founder (or another account admin) with Wrangler, never pasted into an issue, pull request or chat:

| Secret                 | Used for                                                                            | How to make it                                 |
| ---------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | Checking Turnstile tokens on forms (S5)                                             | From the Turnstile widget for that environment |
| `RATE_LIMIT_HMAC_KEY`  | Keyed hashes for rate-limit keys, so no IP address is stored (P3)                   | `openssl rand -base64 32`                      |
| `EMAIL_LOG_HMAC_KEY`   | Keyed hashes in the email log (S3). Must be different from `RATE_LIMIT_HMAC_KEY`    | `openssl rand -base64 32`                      |
| `SAFEGUARDING_KEY`     | Encrypting handed-over safeguarding items (#36, #95). The founder sets the live one | `printf 'v1.%s' "$(openssl rand -base64 32)"`  |

```sh
openssl rand -base64 32 | bunx wrangler secret put RATE_LIMIT_HMAC_KEY --env staging
openssl rand -base64 32 | bunx wrangler preview base-config secret put RATE_LIMIT_HMAC_KEY --env staging
openssl rand -base64 32 | bunx wrangler secret put RATE_LIMIT_HMAC_KEY --env live
```

**`SAFEGUARDING_KEY`** is different from the others (Nadia's condition 3 on #95). The founder generates and sets the live key themselves, with `wrangler secret put SAFEGUARDING_KEY --env live` or in the dashboard, and keeps an offline copy in a password manager with MFA or on paper somewhere physically secure. It never goes in `vars`, the repository, a chat, an issue, an email or a cloud document, and no agent is ever asked to handle it. Losing it loses every record it encrypted. Staging and Previews each get their own key, generated the same way, holding made-up data only. The `v1.` prefix is the key version; a rotation adds `SAFEGUARDING_KEY_PREVIOUS` for a while ([runbook](runbooks/rotate-safeguarding-key.md)). It is not in `secrets.required`: without it, the safeguarding routes answer `503` and store nothing.

Generate a fresh value for every environment and every secret; never reuse one. `TURNSTILE_SECRET_KEY` must be the real secret of that environment's own widget, never Cloudflare's always-pass test secret; only local runs and CI use the test keys. The public site keys are `NUXT_PUBLIC_TURNSTILE_SITE_KEY` in each environment's `vars`, and each widget's hostname list holds only its own environment's host. Previews get their secrets from the Preview base config (`wrangler preview base-config secret`), which every new Preview starts with, separately from staging. `TURNSTILE_SECRET_KEY`, `RATE_LIMIT_HMAC_KEY` and `EMAIL_LOG_HMAC_KEY` are listed in `secrets.required` for local and live, because the form routes and the email sender read them: a deploy fails until all three are set for that environment. Staging leaves them out for now, because its first deploy comes before the secrets can be set. Until they are, its form routes answer `503 unavailable` and store nothing. A follow-up PR adds them back once the secrets exist.

### Local development

`wrangler dev` reads local values from `.dev.vars`, which is ignored and never committed. Use Cloudflare's dummy Turnstile keys (the always-passes test secret `1x0000000000000000000000000000000AA`) and `KINMEET_ENV=local`. With `KINMEET_ENV=local`, and only then, the form routes also accept what the dummy keys report from siteverify: the hostnames `localhost` or `example.com`, and the action `test`. Staging, Previews and live set `KINMEET_ENV` in `wrangler.jsonc`, so they always check the real hostname and the form's own action. A test checks that they refuse the dummy values.

## Logging (P5)

Workers Logs keep only what the code logs, which is errors without personal data. Invocation logs (one line per request, with its URL and headers) and traces are off, Logpush is off, and there are no Tail Workers. The same settings are repeated in each environment so they never depend on inheritance.

## Rules

- Only `env.live` may point at a `kinmeet-live` resource. `env.live.previews` never does, and a unit test (`tests/unit/config/previews.test.ts`) fails if it names a live database, namespace or bucket, or if its logging settings differ from production's.
- Previews don't inherit production settings ([Previews, configuration](https://developers.cloudflare.com/workers/previews/configuration/)), so the `previews` block repeats the P5 logging settings and every binding.
- Never copy live data into Previews. Test data is made up and obviously fake (handbook rule 2).
- `workers_dev` and `preview_urls` are on for `platform`. `preview_urls` is one switch for both `workers.dev` Preview URLs and Version URLs ([Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)), so Previews can't be served on `workers.dev` without it. Version URLs run production versions, rolled-back ones included, with live bindings, and are public when enabled ([Version URLs, manage access](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/#manage-access-to-version-urls)). The Access application over the Previews of `platform` must therefore also cover its Version URLs, and the team checks that a Version URL asks for sign-in before live holds real data. Preview URLs are public by default ([Previews, access control](https://developers.cloudflare.com/workers/previews/#access-control)), so the Access application over every Preview of `platform` must exist before Preview builds are switched on. `workers.dev` Preview URLs send `X-Robots-Tag: noindex`.
- Cloudflare runs Cron Triggers on production only ([Previews, limitations](https://developers.cloudflare.com/workers/previews/resources/#limitations)), so the deletion job never clears the shared Preview database. Empty and reseed it from time to time ([runbook](runbooks/reseed-previews.md)).
