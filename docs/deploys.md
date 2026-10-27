# Deploys

How code reaches Cloudflare. The reasoning is in [ADR-0001](adr/0001-deploys-with-workers-builds.md). Deploys are done by Cloudflare Workers Builds; GitHub Actions only runs CI and the post-deploy check.

> **Moving to one Worker (#115).** Until the founder has done the steps under [Moving to one Worker](#moving-to-one-worker-the-founder) and both builds are verified, the two old Workers, `platform-staging` and `platform-live`, still deploy as before.

| Where           | Worker                         | URL                                                                  | Built from                 | Data                       |
| --------------- | ------------------------------ | -------------------------------------------------------------------- | -------------------------- | -------------------------- |
| Branch Previews | `platform` (Previews)          | `<branch>-platform.kinmeet.workers.dev`, posted on each pull request | Every branch except `live` | `kinmeet-staging`, made-up |
| Staging         | `platform` (Preview of `main`) | https://main-platform.kinmeet.workers.dev                            | `main`                     | `kinmeet-staging`, made-up |
| Live            | `platform` (production)        | https://platform.kinmeet.workers.dev                                 | `live`                     | `kinmeet-live`, real       |

Every Preview, including staging, shares the same made-up-data resources. Migrations are applied to them only by builds of `main`, so a branch that adds a migration runs on `main`'s schema until it merges. Cloudflare does not run scheduled jobs (Cron Triggers) for Previews ([Previews limitations](https://developers.cloudflare.com/workers/previews/resources/#limitations)), so the daily deletion job runs on live only; CI tests it end to end. On the Free plan a Worker can have up to 100 Previews ([Previews limits](https://developers.cloudflare.com/workers/previews/#limits)); delete a Preview when its branch is gone with `bunx wrangler preview delete --name <branch> --env live` ([Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#preview-delete)).

## Releasing to live

Only the founder can do this.

1. On GitHub, open a pull request from `main` into `live`, titled with the date, and list what changed.
2. Check staging looks right, then merge it.
3. Workers Builds builds `live`, applies any new migrations to the live database, and deploys `platform`. Its result shows as a check on the merge commit, followed by the **Check deployed site** workflow.

## Rolling back

Revert the merge on `live` (the founder), or in the Cloudflare dashboard open **Workers & Pages**, then `platform`, then **Deployments**, and roll back to the previous version.

## Moving to one Worker (the founder)

Do these after the team's config pull request for #115 has merged, so the first builds find their config. No token is needed from you at any point. Don't delete or disconnect `platform-staging` or `platform-live` until step 6.

### 1. Create the `platform` Worker from the repository

1. In the Cloudflare dashboard, switch to the **Kinmeet** account.
2. Go to **Workers & Pages**, then **Create application**, then **Import a repository**, and choose `Kinmeet/platform`.
3. Set:
   - **Project name:** `platform`
   - **Build command:** `bun install --frozen-lockfile && bun run build`
   - **Deploy command:** `scripts/d1-migrate.sh live && bunx wrangler deploy --env live`
   - **Root directory:** `/`
   - **Production branch:** `live`
   - Under **Advanced settings**, **Build variables**, add `SKIP_DEPENDENCY_INSTALL` = `1`. If the NuxtHub change (ADR-0009) has merged by then, also add `CLOUDFLARE_ENV` = `live`.
   - Leave the API token as the one Cloudflare creates.
4. Select **Create and deploy**. The first live build is expected to **fail**, because the live secrets aren't set yet (step 4). Nothing is deployed when it fails.

### 2. Turn on Previews

First tell Rowan the Worker exists and wait for the team to confirm that the Access application covering every Preview of `platform`, and its Version URLs, is in place. Preview URLs are public by default ([Previews, access control](https://developers.cloudflare.com/workers/previews/#access-control)), so Previews, including staging, must not be switched on before it exists. The same `preview_urls` setting also turns on Version URLs, which run production versions with live data and are public when enabled ([Version URLs, manage access](https://developers.cloudflare.com/workers/versions-and-deployments/version-urls/#manage-access-to-version-urls)).

1. Open `platform`, then **Settings**, then **Build**, then **Branch control**.
2. Tick **Enable Preview Builds**.
3. Set the **Preview command** to `scripts/d1-migrate.sh preview && bunx wrangler preview --env live` ([Preview command](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/#preview-command)).
4. If a **Set up Worker Previews** banner appears under **Settings**, **Builds**, select **Set up**, check the Preview command above, and select **Switch to Worker Previews**. This cannot be undone, and it is what we want.

### 3. Tell the team

Tell Rowan Previews are on. The team then, without needing anything from you:

- sets the Previews Base secrets, generated inside Cloudflare so nobody sees them;
- creates Access applications for the production paths `/admin`, `/api/admin`, `/safeguarding` and `/api/safeguarding` on `platform.kinmeet.workers.dev`, **with no policy**, so they let nobody in until you add one;
- adds the new addresses to the Turnstile widgets' hostname lists (the old ones are removed in step 6);
- runs a Preview build of `main` and checks it.

### 4. Set the live secrets and policies

1. Set the live secrets on `platform` (production), each with a fresh value. Never reuse a value from the old Workers or from Previews:
   - `TURNSTILE_SECRET_KEY`: the secret of the live Turnstile widget (**Turnstile**, the live widget, **Settings**).
   - `RATE_LIMIT_HMAC_KEY` and `EMAIL_LOG_HMAC_KEY`: on your own machine, `openssl rand -base64 32 | bunx wrangler secret put RATE_LIMIT_HMAC_KEY --env live`, and the same for `EMAIL_LOG_HMAC_KEY`.
   - `SAFEGUARDING_KEY`: only after go-live condition 6 is done and verified, as #95 step 8 says.
2. In **Zero Trust**, **Access**, **Applications**, add your policies to the production `admin` and `safeguarding` applications, as for the old live Worker.

### 5. Release and verify

1. Release to live as usual (merge `main` into `live`). The team checks that the live build succeeds and the **Check deployed site** workflow passes for https://platform.kinmeet.workers.dev, and that the Preview of `main` passes too.
2. The team also opens the Version URL of that live version (`<version-prefix>-platform.kinmeet.workers.dev`) and checks it asks for an Access sign-in. If it doesn't, nothing goes live with real data until it does.

### 6. Retire the old Workers

Only once the team has confirmed step 5:

1. Delete the `platform-staging` and `platform-live` Workers (**Workers & Pages**, the Worker, **Settings**, **Delete**). This also ends their Workers Builds connections.
2. In **My Profile**, **API Tokens**, delete "platform-staging build token" and "platform-live build token".
3. In **Zero Trust**, **Access**, **Applications**, delete the `platform-staging` applications (admin, Previews and safeguarding).
4. Delete the retired made-up-data resources: D1 `kinmeet-preview`, the KV namespaces `kinmeet-preview` and `kinmeet-preview-receipts`, and the R2 bucket `kinmeet-preview`. The team lists them on #115 before you do.
5. Delete the staging Turnstile widget, and remove the old Worker addresses from the Preview and live widgets. The team names them on #115.

## The original setup (25 October 2026)

The steps for the two-Worker setup are in this file's history (#8). They are replaced by the steps above.
