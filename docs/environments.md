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

| Resource             | Id                                     |
| -------------------- | -------------------------------------- |
| D1 `kinmeet-staging` | `18c80f5f-3c72-4781-8d38-98ef6cc4a096` |
| D1 `kinmeet-preview` | `74454f75-8b40-44d7-ac02-e6145d9e8ff6` |
| D1 `kinmeet-live`    | `3b253758-831e-4db9-bb90-fb4598f215db` |
| KV `kinmeet-staging` | `5a9d7b8c548a4c3a8d596eec650a474b`     |
| KV `kinmeet-preview` | `87dfe82d807e49cf945334fbd17d7b26`     |
| KV `kinmeet-live`    | `90bba5907a604bc49aead31e93c939fc`     |

R2 buckets are named, not numbered: `kinmeet-staging`, `kinmeet-preview` and `kinmeet-live`. Matt creates them in the dashboard with jurisdiction EU (step 1 of the one-time setup in [deploys.md](deploys.md)), because the team's API connection cannot set an R2 jurisdiction. Deploys fail until they exist.

## Rules

- Only `env.live` may point at a `kinmeet-live` resource. Previews and staging never touch live data.
- Never copy live data into staging or Previews. Test data is made up and obviously fake (handbook rule 2).
- `workers_dev` is on for staging and live (no custom domain yet). `preview_urls` is on for staging only, because Worker Previews are served on `workers.dev` through it; it is off for live, so no other version of the live Worker can be reached. Preview URLs send `X-Robots-Tag: noindex`; they go behind Cloudflare Access once forms or admin pages exist.
