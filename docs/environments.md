# Environments

Every resource is in the Kinmeet Cloudflare account (`0fa695ccf43f64b3eb9fae94520109b4`) and was created with **jurisdiction `eu`**, so its data is guaranteed to stay in the EU (P3). A location hint is only best effort and the jurisdiction can only be set when a resource is created, so a resource without it must be recreated, not changed.

Resource ids are not secrets. They live in [`wrangler.jsonc`](../wrangler.jsonc). How each environment is built and deployed is in [deploys.md](deploys.md) and [ADR-0001](adr/0001-deploys-with-workers-builds.md).

| Environment           | Wrangler               | Worker                          | Built from                          | D1 (`DB`)         | KV (`KV`)         | R2 (`R2`)         | Data    |
| --------------------- | ---------------------- | ------------------------------- | ----------------------------------- | ----------------- | ----------------- | ----------------- | ------- |
| Local                 | top level              | `kinmeet-local`, never deployed | your machine                        | simulated         | simulated         | simulated         | made-up |
| Pull request Previews | `env.staging.previews` | Previews of `kinmeet-staging`   | any branch except `main` and `live` | `kinmeet-preview` | `kinmeet-preview` | `kinmeet-preview` | made-up |
| Staging               | `env.staging`          | `kinmeet-staging`               | `main`                              | `kinmeet-staging` | `kinmeet-staging` | `kinmeet-staging` | made-up |
| Live                  | `env.live`             | `kinmeet-live`                  | `live` (Matt only)                  | `kinmeet-live`    | `kinmeet-live`    | `kinmeet-live`    | real    |

`KINMEET_ENV` is set to `staging`, `preview` or `live` so the app can tell where it is running.

## Ids

| Resource                                   | Id                                     |
| ------------------------------------------ | -------------------------------------- |
| D1 `kinmeet-staging`                       | `18c80f5f-3c72-4781-8d38-98ef6cc4a096` |
| D1 `kinmeet-preview`                       | `74454f75-8b40-44d7-ac02-e6145d9e8ff6` |
| D1 `kinmeet-live`                          | `3b253758-831e-4db9-bb90-fb4598f215db` |
| KV `kinmeet-staging`                       | `5a9d7b8c548a4c3a8d596eec650a474b`     |
| KV `kinmeet-preview`                       | `87dfe82d807e49cf945334fbd17d7b26`     |
| KV `kinmeet-live`                          | `90bba5907a604bc49aead31e93c939fc`     |
| KV `kinmeet-staging-receipts` (`RECEIPTS`) | `ebb759901980452ab6415f7aeb1dff99`     |
| KV `kinmeet-preview-receipts` (`RECEIPTS`) | `3119a6ddccfe45c6910468d4685cd186`     |
| KV `kinmeet-live-receipts` (`RECEIPTS`)    | `94c4f3e1ef6c402092221decd4e4373c`     |

R2 buckets are named, not numbered: `kinmeet-staging`, `kinmeet-preview` and `kinmeet-live`. Matt creates them in the dashboard with jurisdiction EU (step 1 of the one-time setup in [deploys.md](deploys.md)), because the team's API connection cannot set an R2 jurisdiction. Deploys fail until they exist.

## Other bindings

- `RECEIPTS` (KV): receipt-limit markers for the forms API, in its own namespace per environment so its retention can differ from `KV`.
- `FORM_RATE_LIMITER` (5 per 60 seconds) and `FORM_GLOBAL_RATE_LIMITER` (100 per 60 seconds, to be tuned by Services). Counts are per Cloudflare location. Each environment has its own `namespace_id` (local 100x, staging 110x, Previews 120x, live 130x), because limiters with the same id share counters across Workers.
- D1 migrations live in `migrations/db/`.

## Secrets

Secrets are never in the repository. Each environment needs its own values, set by Matt (or another account admin) with Wrangler, never pasted into an issue, pull request or chat:

| Secret                 | Used for                                                                         | How to make it                                 |
| ---------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------- |
| `TURNSTILE_SECRET_KEY` | Checking Turnstile tokens on forms (S5)                                          | From the Turnstile widget for that environment |
| `RATE_LIMIT_HMAC_KEY`  | Keyed hashes for rate-limit keys, so no IP address is stored (P3)                | `openssl rand -base64 32`                      |
| `EMAIL_LOG_HMAC_KEY`   | Keyed hashes in the email log (S3). Must be different from `RATE_LIMIT_HMAC_KEY` | `openssl rand -base64 32`                      |

```sh
openssl rand -base64 32 | bunx wrangler secret put RATE_LIMIT_HMAC_KEY --env staging
openssl rand -base64 32 | bunx wrangler preview base-config secret put RATE_LIMIT_HMAC_KEY --env staging
openssl rand -base64 32 | bunx wrangler secret put RATE_LIMIT_HMAC_KEY --env live
```

Generate a fresh value for every environment and every secret; never reuse one. Previews get their secrets from the Preview base config (`wrangler preview base-config secret`), which every new Preview starts with, separately from staging. `TURNSTILE_SECRET_KEY` and `RATE_LIMIT_HMAC_KEY` are listed in `secrets.required` for local and live, because the form routes read them: a deploy fails until both are set for that environment. Staging leaves them out for now, because its first deploy comes before the secrets can be set. Until they are, its form routes answer `503 unavailable` and store nothing. A follow-up PR adds them back once the secrets exist.

### Local development

`wrangler dev` reads local values from `.dev.vars`, which is ignored and never committed. Use Cloudflare's dummy Turnstile keys (the always-passes test secret `1x0000000000000000000000000000000AA`) and `KINMEET_ENV=local`. With `KINMEET_ENV=local`, and only then, the form routes also accept what the dummy keys report from siteverify: the hostnames `localhost` or `example.com`, and the action `test`. Staging, Previews and live set `KINMEET_ENV` in `wrangler.jsonc`, so they always check the real hostname and the form's own action. A test checks that they refuse the dummy values.

## Logging (P5)

Workers Logs keep only what the code logs, which is errors without personal data. Invocation logs (one line per request, with its URL and headers) and traces are off, Logpush is off, and there are no Tail Workers. The same settings are repeated in each environment so they never depend on inheritance.

## Rules

- Only `env.live` may point at a `kinmeet-live` resource. Previews and staging never touch live data.
- Never copy live data into staging or Previews. Test data is made up and obviously fake (handbook rule 2).
- `workers_dev` is on for staging and live (no custom domain yet). `preview_urls` is on for staging only, because Worker Previews are served on `workers.dev` through it; it is off for live, so no other version of the live Worker can be reached. Preview URLs send `X-Robots-Tag: noindex`; they go behind Cloudflare Access once forms or admin pages exist.
