# Sprint 0 research: versions and recommended setup

Researched by Ines Duarte (Research Scout), 25 October 2026, for Sprint 0 ticket #9.

Every version below was read from the npm registry (`npm view <package>`) on 25 October 2026 unless another source is named. Cloudflare facts come from developers.cloudflare.com; each claim links to the page it came from. Where the plan Priya shared looks out of date, the item is marked **Flag**.

## Summary of flags

1. **Node 24 is now in maintenance, and Node 26 becomes Active LTS on 28 October 2026.** Node 24 is still supported until April 2028, so it is a safe choice for Sprint 0, but we should decide now rather than in three days. Recommendation: pin Node 24.x for Sprint 0 and open a small follow-up to move to 26 once it is LTS and Wrangler and Nuxt CI are green on it.
2. **TypeScript 7.0.2 should not be used yet.** vue-tsc and typescript-eslint do not support it. Pin **TypeScript 6.0.x** (not 5.x): typescript-eslint supports up to `<6.1.0`, and vue-tsc supports `>=5.0.0`.
3. **`nodejs_compat` is now on by default** for Workers with a compatibility date of 2026-08-04 or later. We do not need to add the flag, and we must set Nitro's compatibility date ourselves because its built-in default is still 2025-07-15.
4. **Use D1 and R2 jurisdictions, not only location hints, if P3 needs a guarantee.** A location hint is best effort; `jurisdiction: "eu"` is a guarantee and can only be set when the database or bucket is created. KV jurisdictions became generally available on 2 October 2026 too. Note that the UK is not in the EU jurisdiction, so this is a privacy decision for P3, not a technical default (see the Storage section).
5. **`cloudflare.deployConfig` discards dashboard settings.** Nitro turns it on automatically inside Workers Builds. If we deploy with GitHub Actions we keep it off and own `wrangler.jsonc` in the repository.
6. **Cloudflare's own docs pin old action versions** (`actions/checkout@v6`); current tags are newer. Pin by commit SHA anyway.
7. **Cloudflare's Vitest docs still show `vitest@^4.1.0`**, but `@cloudflare/vitest-plugin` 1.4.7 accepts `^4.1.0 || ^5.0.0`. Vitest 5 should work; Kit should confirm in the test-harness ticket before we rely on it.

## Package versions

| Package                                   | Plan said  | Verified latest                            | Notes                                                                                                                                                                                          |
| ----------------------------------------- | ---------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `nuxt`                                    | 4.6.2      | 4.6.2                                      | `engines.node`: `^22.22.3 \|\| ^24.15.0 \|\| >=26.0.0`. Depends on `@nuxt/nitro-server` 4.6.2, which depends on `nitropack` `^2.13.4` (latest 2.13.5), so Nitro 2 is correct.                  |
| `wrangler`                                | 4.152.0    | 4.152.0                                    | `engines.node`: `>=22.0.0`.                                                                                                                                                                    |
| `@cloudflare/vitest-plugin`               | 1.4.7      | 1.4.7                                      | Peer `vitest`: `^4.1.0 \|\| ^5.0.0`. Rename confirmed (see below).                                                                                                                             |
| `@cloudflare/vitest-pool-workers`         | (renamed)  | 0.23.0, deprecated                         | npm deprecation notice: "has been renamed to @cloudflare/vitest-plugin. This package will not receive future updates." Do not install.                                                         |
| `vitest`                                  | 5.0.5      | 5.0.5                                      | Also accepted by `@nuxt/test-utils` 4.3.4 (peer `^4.0.2 \|\| ^5.0.0`).                                                                                                                         |
| `@nuxt/test-utils`                        | not listed | 4.3.4                                      | Peer `nuxt` `^3.21.0 \|\| ^4.0.0`, `@playwright/test` `^1.43.1`.                                                                                                                               |
| `@playwright/test`                        | 1.64.1     | 1.64.1                                     | `engines.node`: `>=20`. Published 25 October 2026.                                                                                                                                             |
| `@axe-core/playwright`                    | 4.14       | 4.14.0                                     | Peer `playwright-core` `>= 1.0.0`.                                                                                                                                                             |
| `@nuxtjs/i18n`                            | 10.6       | 10.6.0                                     | `engines.node`: `>=20.11.1`.                                                                                                                                                                   |
| `@nuxt/eslint`                            | 1.17       | 1.17.0                                     | Peer `eslint` `^9.0.0 \|\| ^10.0.0` (latest eslint 10.13.0).                                                                                                                                   |
| `typescript`                              | 7.0.2      | 7.0.2 latest; 6.0.3 latest 6.x; 7.1.0-beta | **Flag 2.** Use 6.0.x.                                                                                                                                                                         |
| `vue-tsc`                                 | not listed | 3.3.13                                     | Peer `typescript` `>=5.0.0`. Built on `@volar/typescript`, which needs the TypeScript JavaScript API.                                                                                          |
| `@typescript-eslint/parser`               | not listed | 8.72.0                                     | Peer `typescript` `>=4.8.4 <6.1.0`. This is what rules out TypeScript 7 for linting.                                                                                                           |
| `bun` (package manager and script runner) | 1.4.4      | 1.4.4                                      | Replaces pnpm (the founder's decision, 25 October 2026). Published 22 October 2026. Pin with `packageManager` in `package.json`. Node 24 is still required: see [Bun and Node](#bun-and-node). |
| `vue`                                     | not listed | 3.5.44                                     | Comes with Nuxt.                                                                                                                                                                               |

### TypeScript 7

TypeScript 7.0 is the Go-native compiler and does not ship the programmatic API that vue-tsc (Volar) uses, so Vue template type checking does not run on it. Support is tracked in [vuejs/language-tools#5381](https://github.com/vuejs/language-tools/issues/5381); the current vue-tsc release (3.3.13, 10 October 2026) has no TypeScript 7 support, and TypeScript 7.1 is still in beta (7.1.0-beta published 20 October 2026). Separately, typescript-eslint's peer range stops at `<6.1.0`.

Recommendation: `"typescript": "~6.0.3"`. Revisit when vue-tsc and typescript-eslint both list 7.x in their peer ranges.

### Node.js

From the [Node.js release schedule](https://github.com/nodejs/Release/blob/main/schedule.json) and [nodejs.org/dist/index.json](https://nodejs.org/dist/index.json):

| Line | Status on 25 Oct 2026                    | End of life   | Latest  |
| ---- | ---------------------------------------- | ------------- | ------- |
| 22   | Maintenance                              | 30 April 2027 | 22.23.4 |
| 24   | Maintenance since 20 October 2026        | 30 April 2028 | 24.22.1 |
| 26   | Current; Active LTS from 28 October 2026 | 30 April 2029 | 26.12.1 |

Recommendation (**Flag 1**): pin `24` in `.nvmrc` and `engines` for Sprint 0 (meets Nuxt's `^24.15.0` and Wrangler's `>=22`). Nuxt already lists `>=26.0.0`, so moving to 26 after 28 October should be a one-line change once CI passes on it.

### Bun and Node

We use Bun as the package manager and script runner, but Nuxt, Vitest and Wrangler still run on Node 24:

- `bun run <script>` respects a CLI's `#!/usr/bin/env node` shebang and runs it with Node, unless `--bun` is passed ([Bun: bun run, Shebangs](https://bun.sh/docs/cli/run)). `nuxt`, `vitest` and `wrangler` are all Node-shebang CLIs, so `bun run dev`, `bun run build` and `bun run test` run them on Node 24. Do not add `--bun`.
- CI therefore needs both `actions/setup-node` (Node 24) and `oven-sh/setup-bun` (Bun 1.4.4).
- The test command is **`bun run test`, never `bun test`**. When a built-in Bun command has the same name as a package script, the built-in wins ([Bun: bun run](https://bun.sh/docs/cli/run)), so `bun test` starts Bun's own test runner instead of Vitest and skips the Workers runtime and the Nuxt test environment.

## Workers Vitest integration

- The package was renamed on 19 August 2026: [changelog: @cloudflare/vitest-pool-workers is now @cloudflare/vitest-plugin](https://developers.cloudflare.com/changelog/post/2026-08-19-vitest-plugin/). "The Vitest configuration API is unchanged."
- Configuration uses the `cloudflareTest()` Vite plugin inside Vitest's `defineConfig` ([Configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)):

  ```ts
  import { cloudflareTest } from '@cloudflare/vitest-plugin'
  import { defineConfig } from 'vitest/config'

  export default defineConfig({
    plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  })
  ```

- TypeScript `types` entry is `@cloudflare/vitest-plugin/types` ([Migrate to Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-to-vitest-plugin/)).
- Storage is isolated per test file, not per test; custom Vitest `environment`s or `runner`s are not supported ([Migrate from Vitest 3 to 4](https://developers.cloudflare.com/workers/testing/vitest-integration/migration-guides/migrate-from-vitest-3-to-vitest-4/), [Configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)). Nuxt component tests (`@nuxt/test-utils`, happy-dom) therefore need a separate Vitest project from the Workers-runtime tests.
- `readD1Migrations()` is available for applying D1 migrations in tests ([Configuration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/)).
- Outbound request mocks: Cloudflare now points to `@msw/cloudflare` ([Mock outbound requests](https://developers.cloudflare.com/workers/testing/vitest-integration/mock-outbound-requests/)). Useful for the no-third-party test and for Turnstile in Sprint 1.
- **Flag 7**: the [Write your first test](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/) page (updated 17 October 2026) installs `vitest@^4.1.0`; the package's npm peer range also allows `^5.0.0`.

## Nuxt on Workers

### Preset

- Cloudflare's [Nuxt framework guide for Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/) (updated 23 April 2026) uses `npm create cloudflare@latest -- my-nuxt-app --framework=nuxt`, serves the server bundle from `.output/server/index.mjs` and static files through Workers static assets from `.output/public`.
- [Nitro's Cloudflare provider docs](https://nitro.build/deploy/providers/cloudflare) use `preset: "cloudflare_module"` for Workers. The Nitro 2.13.5 source lists these Cloudflare presets: `cloudflare-module`, `cloudflare-module-legacy`, `cloudflare-durable`, `cloudflare-pages`, `cloudflare-pages-static`, `cloudflare-worker` (legacy service worker) and `cloudflare-dev`. `cloudflare_module` is the right one for us.
- [Automatic configuration](https://developers.cloudflare.com/workers/framework-guides/automatic-configuration/) now runs by default: `wrangler deploy` in a project with no Wrangler config detects Nuxt and writes one. We should commit our own `wrangler.jsonc` so this never runs in CI.

### `nodeCompat` and the compatibility date (Flag 3)

- [Changelog, 4 August 2026: Node.js compatibility is now enabled by default](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/): with a compatibility date of `2026-08-04` or later, `nodejs_compat` and `nodejs_compat_v2` are on by default. New projects do not need either flag. See also [Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#nodejs-compatibility-flag).
- In Nitro 2.13.5 (`dist/presets/cloudflare/utils.mjs`), `cloudflare.nodeCompat` is switched on automatically when the Wrangler config has `nodejs_compat` or `nodejs_compat_v2`, or the compatibility date is on or after `2026-08-04`, or `deployConfig` is on. So we do not need to set `nodeCompat` by hand, provided the date is current.
- Nitro's built-in default `compatibilityDate` for Cloudflare is still `2025-07-15`. Set it explicitly in `nuxt.config.ts` (`compatibilityDate: "2026-10-25"`) and the same date in `wrangler.jsonc`, so the two never disagree.
- Cloudflare's [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/) recommend keeping the compatibility date current, enabling source maps (`upload_source_maps: true`) and running `wrangler types` before type checking.

### `deployConfig` (Flag 5)

- In Nitro 2.13.5, `cloudflare.deployConfig` defaults to `true` only when it detects it is running inside Workers Builds (`std-env` provider `cloudflare_workers`). Its type comment says: "Enabling this option will cause settings from cloudflare dashboard (including environment variables) to be disabled and discarded."
- If we deploy from GitHub Actions, leave `deployConfig` off and keep `wrangler.jsonc` in the repository as the single source of truth for bindings and environments. If we ever use Workers Builds, set `deployConfig: false` explicitly or accept that the generated config wins.

### Static assets

- Workers static assets are configured with `assets.directory` (here `.output/public`) and an optional `binding` ([Static assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)). By default a request that matches an asset is served without running the Worker; `run_worker_first` changes that.
- This matters for security headers (P5): asset responses skip the Worker unless `run_worker_first` is set, so headers for static files must come from a `_headers` file in the assets directory or from `run_worker_first`. Theo and Jun should pick one in the security-headers ticket.
- Use `.assetsignore` to stop server files being uploaded as public assets ([Static assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)).

### `workers.dev` and preview URLs

- Preview URLs follow the `workers.dev` setting from Wrangler 4.44.0 onwards ([changelog](https://developers.cloudflare.com/changelog/post/2025-09-17-update-preview-url-setting/)). They are public, so set `preview_urls` deliberately in `wrangler.jsonc` for staging and live.
- If `workers.dev` is disabled in the dashboard but not in `wrangler.jsonc` (`workers_dev = false`), the next Wrangler deploy turns it back on ([workers.dev routing](https://developers.cloudflare.com/workers/configuration/routing/workers-dev/)).

## Storage location (Flag 4)

### D1

From [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/) (updated 2 October 2026):

- **Location hint** (`wrangler d1 create <name> --location=weur`): "does not guarantee that D1 runs in your preferred location." Hints: `wnam`, `enam`, `weur`, `eeur`, `apac`, `oc`. Without a hint, D1 picks a location near where the create request came from, so a database created from a US-based CI runner could land in North America.
- **Jurisdiction** (`wrangler d1 create <name> --jurisdiction=eu`): guarantees the database runs and stores data within the EU. Options: `eu`, `us` (added [2 October 2026](https://developers.cloudflare.com/changelog/post/2026-10-02-us-jurisdiction/)), `fedramp`. Set only at creation, cannot be changed, and overrides any location hint. Read replicas stay inside the jurisdiction.
- There is no UK jurisdiction.

### R2

From [R2 data location](https://developers.cloudflare.com/r2/reference/data-location/):

- Same choice: a best-effort location hint (`weur`), or a jurisdiction (`eu`, `us`, `fedramp`) that guarantees storage and processing in that region. The jurisdiction cannot be changed after the bucket is created.
- A jurisdiction bucket needs `"jurisdiction": "eu"` in the `r2_buckets` binding, and the S3 endpoint becomes `https://<ACCOUNT_ID>.eu.r2.cloudflarestorage.com`.
- Location hints are only honoured the first time a bucket name is created.
- Logpush cannot write to jurisdiction buckets directly.

### KV

- [KV jurisdictions are generally available](https://developers.cloudflare.com/changelog/post/2026-10-02-kv-jurisdictions-ga/) (2 October 2026): `wrangler kv namespace create <name> --jurisdiction=eu`, creation-time only.

Recommendation: create every staging and live D1 database, R2 bucket and KV namespace with `--jurisdiction=eu`, because a hint is not a guarantee and none of these can be changed later. This should be confirmed against P3 (data map and retention) and P6 (DPIA) before Jun creates anything, since it is a data-location decision, not only a technical one. Either way, Jun's provisioning script must always pass `account_id` for the Kinmeet account.

## Deploying: Workers Builds or GitHub Actions

From [Workers CI/CD](https://developers.cloudflare.com/workers/ci-cd/) (updated 1 October 2026), [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/) and [GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/) (updated 18 October 2026):

|                       | Workers Builds                                                                                                                                                                                   | GitHub Actions + `cloudflare/wrangler-action@v4`                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Where it runs         | Cloudflare                                                                                                                                                                                       | GitHub runners                                                                                               |
| Gating on our CI      | Separate system: builds on push to a branch, not tied to our required checks                                                                                                                     | Deploy job can `needs:` the test, accessibility and no-third-party jobs in the same workflow                 |
| Credentials           | Cloudflare generates an API token automatically by default                                                                                                                                       | We create a scoped API token (Edit Cloudflare Workers, Kinmeet account only) and store it as a GitHub secret |
| Wrangler environments | One connected Worker per environment, each with `--env` in its deploy command ([advanced setups](https://developers.cloudflare.com/workers/ci-cd/builds/advanced-setups/#wrangler-environments)) | `command: deploy --env staging` per job                                                                      |
| Nitro                 | Turns on `deployConfig` (Flag 5)                                                                                                                                                                 | `deployConfig` stays off                                                                                     |
| Other notes           | Does not honour Wrangler custom builds                                                                                                                                                           | Live deploy can sit behind a GitHub environment with the founder as required reviewer (firm rule 6)          |

Recommendation: **GitHub Actions with `cloudflare/wrangler-action@v4`**. It lets the deploy wait for every required check, keeps the API token scoped to the Kinmeet account, and gives us a clean approval gate for live releases.

Current tags (from `git ls-remote --tags`, 25 October 2026): `cloudflare/wrangler-action` v4.1.3, `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `oven-sh/setup-bun` v2.2.0 (`0c5077e51419868618aeaa5fe8019c62421857d6`, the same commit as the `v2` tag). **Flag 6**: Cloudflare's example uses `actions/checkout@v6`. Pin every action to a full commit SHA with the tag in a comment.

## Features that can inject third-party scripts

The firm rule is no third-party requests on any page (except Turnstile on form pages). These Cloudflare features can add scripts to HTML:

| Feature                       | What it injects                                                                      | Scope                                                             | Source                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Web Analytics automatic setup | `beacon.min.js` RUM beacon, reporting to `/cdn-cgi/rum`                              | Sites proxied through a Cloudflare zone                           | [RUM beacon](https://developers.cloudflare.com/speed/observatory/rum-beacon/), [FAQ](https://developers.cloudflare.com/web-analytics/faq/)                                                 |
| Email Address Obfuscation     | `email-decode.min.js` (deferred since 14 April 2026), and rewrites addresses in HTML | Zone setting, on by default for new zones                         | [Email Address Obfuscation](https://developers.cloudflare.com/waf/tools/scrape-shield/email-address-obfuscation/)                                                                          |
| Rocket Loader                 | Rewrites `<script>` tags and adds its loader                                         | Zone setting, or per hostname via configuration rules             | [Rocket Loader](https://developers.cloudflare.com/speed/optimization/content/rocket-loader/), [configuration rules](https://developers.cloudflare.com/rules/configuration-rules/settings/) |
| Zaraz                         | Third-party tool loader                                                              | Zone setting (configured per zone; I found no workers.dev option) | [Zaraz](https://developers.cloudflare.com/zaraz/)                                                                                                                                          |

Nuxt's own [deployment docs](https://nuxt.com/docs/4.x/getting-started/deployment) also tell you to turn off Rocket Loader and Email Address Obfuscation because they cause hydration errors.

All four are **zone** features. On `*.kinmeet.workers.dev` the hostname belongs to Cloudflare's `workers.dev` zone, not to us, so none of our zone settings can apply. I checked the Kinmeet account (`0fa695ccf43f64b3eb9fae94520109b4`) through the Cloudflare API on 25 October 2026 with read-only calls:

- `GET /zones?account.id=…` returned **0 zones**.
- `GET /accounts/…/rum/site_info/list` returned **no Web Analytics sites**.
- `GET /accounts/…/workers/subdomain` returned `kinmeet`.

So today nothing can inject a script on our pages. The risk arrives with a custom domain: when we add a zone, Email Address Obfuscation will be on by default and Web Analytics can be one click away. Recommendations:

1. The no-third-party CI test (Playwright, against the deployed staging URL as well as local) is the real guard. It should fail on any request to a host other than our own and `challenges.cloudflare.com` on form pages, and on any `<script>` whose `src` is off-origin or under `/cdn-cgi/` (except Turnstile).
2. A Content-Security-Policy with `script-src 'self'` plus Turnstile (P5) blocks injected scripts in the browser even if a setting is switched on by mistake.
3. When a custom domain zone is added, a runbook step turns off Email Address Obfuscation, Rocket Loader, Zaraz and Web Analytics automatic setup, and adds a scheduled check of those zone settings through the API.

## Sources

npm registry entries read with `npm view` on 25 October 2026: `nuxt`, `@nuxt/nitro-server`, `nitropack`, `wrangler`, `@cloudflare/vitest-plugin`, `@cloudflare/vitest-pool-workers`, `vitest`, `@nuxt/test-utils`, `@playwright/test`, `@axe-core/playwright`, `@nuxtjs/i18n`, `@nuxt/eslint`, `eslint`, `typescript`, `vue-tsc`, `@typescript-eslint/parser`, `bun`, `vue`. Nitro preset behaviour read from the published `nitropack@2.13.5` package source.

- Bun: https://bun.sh/docs/cli/run
- Node.js: https://github.com/nodejs/Release/blob/main/schedule.json, https://nodejs.org/dist/index.json
- Vue language tools, TypeScript 7 support: https://github.com/vuejs/language-tools/issues/5381
- Cloudflare Vitest integration: https://developers.cloudflare.com/workers/testing/vitest-integration/ and the pages linked above
- Nuxt on Workers: https://developers.cloudflare.com/workers/framework-guides/web-apps/more-web-frameworks/nuxt/
- Nitro Cloudflare provider: https://nitro.build/deploy/providers/cloudflare
- Nuxt deployment (CDN proxy notes): https://nuxt.com/docs/4.x/getting-started/deployment
- Node.js compatibility default: https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/
- Static assets: https://developers.cloudflare.com/workers/static-assets/binding/
- D1 data location: https://developers.cloudflare.com/d1/configuration/data-location/
- R2 data location: https://developers.cloudflare.com/r2/reference/data-location/
- KV jurisdictions: https://developers.cloudflare.com/changelog/post/2026-10-02-kv-jurisdictions-ga/
- CI/CD: https://developers.cloudflare.com/workers/ci-cd/ and https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/
- Web Analytics, Email Address Obfuscation, Rocket Loader: pages linked in the table above
