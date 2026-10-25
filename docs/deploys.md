# Deploys

How code reaches the Kinmeet Workers. The reasoning is in [ADR-0001](adr/0001-deploys-with-workers-builds.md). Deploys are done by Cloudflare Workers Builds; GitHub Actions only runs CI and the post-deploy check.

| Where | Worker | URL | Built from | Data |
| --- | --- | --- | --- | --- |
| Pull request Previews | `kinmeet-staging` (Previews) | Posted on each pull request | Every branch except `main` and `live` | `kinmeet-preview`, made-up |
| Staging | `kinmeet-staging` | https://kinmeet-staging.kinmeet.workers.dev | `main` | `kinmeet-staging`, made-up |
| Live | `kinmeet-live` | https://kinmeet-live.kinmeet.workers.dev | `live` | `kinmeet-live`, real |

## Releasing to live

Only Matt can do this.

1. On GitHub, open a pull request from `main` into `live`, titled with the date, and list what changed.
2. Check staging looks right, then merge it.
3. Workers Builds builds `live` and deploys `kinmeet-live`. Its result shows as a check on the merge commit, followed by the **Check deployed site** workflow.

## Rolling back

Revert the merge on `live` (Matt), or in the Cloudflare dashboard open **Workers & Pages**, then `kinmeet-live`, then **Deployments**, and roll back to the previous version.

## One-time setup (Matt)

Do these after the pull request that adds `env.staging` and `env.live` to `wrangler.jsonc` (#4) has merged, so the first builds find their config. No token is needed from you at any point.

### 1. Create the R2 buckets

The Cloudflare API cannot set a bucket's jurisdiction through the team's connection, so these are made in the dashboard.

1. In the Cloudflare dashboard, switch to the **Kinmeet** account.
2. Go to **R2 Object Storage**, then **Create bucket**.
3. Name it `kinmeet-staging`. Under **Location**, choose **Specify jurisdiction** and then **European Union (EU)**. Leave storage class as **Standard**. Select **Create bucket**.
4. Repeat for `kinmeet-live` and `kinmeet-preview`, both with jurisdiction **European Union (EU)**.
5. Leave public access off on all three.

### 2. Connect `kinmeet-staging` to Workers Builds

1. Go to **Workers & Pages**, then **Create application**, then **Import a repository**.
2. When asked, install the **Cloudflare Workers and Pages** GitHub app on the **Kinmeet** organisation, with **Only select repositories** and just `Kinmeet/platform`.
3. Choose `Kinmeet/platform`, then set:
   - **Project name:** `kinmeet-staging` (it must match the Worker name in `wrangler.jsonc`)
   - **Build command:** `bun install --frozen-lockfile && bun run build`
   - **Deploy command:** `scripts/d1-migrate.sh staging && bunx wrangler deploy --env staging`
   - **Root directory:** `/`
   - **Production branch:** `main`
   - Under **Advanced settings**, **Build variables**, add `SKIP_DEPENDENCY_INSTALL` = `1`
   - Leave the API token as the one Cloudflare creates.
4. Select **Create and deploy**.
5. Open the Worker, then **Settings**, then **Build**, then **Branch control**:
   - Tick **Enable Preview Builds**.
   - Set the **Preview command** to `bunx wrangler preview --env staging`. If the dashboard insists the command starts with `npx wrangler preview`, use `npx wrangler preview --env staging`, which runs the same project copy of Wrangler.
6. If a **Set up Worker Previews** banner appears under **Settings**, **Builds**, select **Set up**, check the Preview command above, and select **Switch to Worker Previews**. This cannot be undone, and it is what we want.

### 3. Connect `kinmeet-live` to Workers Builds

1. Go to **Workers & Pages**, then **Create application**, then **Import a repository**, and choose `Kinmeet/platform` again.
2. Set:
   - **Project name:** `kinmeet-live`
   - **Build command:** `bun install --frozen-lockfile && bun run build`
   - **Deploy command:** `scripts/d1-migrate.sh live && bunx wrangler deploy --env live`
   - **Root directory:** `/`
   - **Production branch:** `live`
   - **Build variables:** `SKIP_DEPENDENCY_INSTALL` = `1`
3. Select **Create and deploy**. The first build fails if the `live` branch does not exist yet; that is fine.
4. Open the Worker, then **Settings**, then **Build**, then **Branch control**, and **untick Enable Preview Builds**, so no branch other than `live` ever builds this Worker.

### 4. Tidy up GitHub

1. Create the `live` branch from `main` and apply the `live` ruleset (only organisation admins can update it).
2. In https://github.com/Kinmeet/platform/settings/environments, delete the `staging` and `live` environments, and any `CLOUDFLARE_API_TOKEN` secret, made for the earlier plan. They are no longer used.

### 5. Tell the team

Tell Rowan when it is done. The team will check the first staging build, confirm the post-deploy check fires, and adjust it if Cloudflare names its check differently.
