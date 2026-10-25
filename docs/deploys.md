# Deploys

How code reaches the Kinmeet Workers. The reasoning is in [ADR-0001](adr/0001-deploys-with-github-actions.md).

| Environment | Worker | URL | Deployed when |
| --- | --- | --- | --- |
| Staging | `kinmeet-staging` | https://kinmeet-staging.kinmeet.workers.dev | CI passes on a push to `main` |
| Live | `kinmeet-live` | https://kinmeet-live.kinmeet.workers.dev | A release is published and Matt approves it |

## Releasing to live

1. On GitHub, go to **Releases**, then **Draft a new release**.
2. Create a tag on `main` named `v` plus the date and a number, for example `v2026.10.25-1`, and describe what changed.
3. Select **Publish release**. The **Deploy** workflow starts and waits.
4. Matt opens the waiting run in **Actions**, selects **Review deployments**, ticks `live` and selects **Approve and deploy**.

## One-time setup (Matt)

Never paste the token anywhere except the GitHub secret field.

### 1. Create the Cloudflare API token

1. In the Cloudflare dashboard, switch to the **Kinmeet** account.
2. Go to **Manage account**, then **Account API tokens**, then **Create Token**, then **Custom token**.
3. Name it `github-actions-deploy`.
4. Add these permissions (all **Account** level):
   - Workers Scripts: Edit
   - D1: Edit
   - Workers KV Storage: Edit
   - Workers R2 Storage: Edit
   - Account Settings: Read
5. Leave client IP filtering empty (GitHub's runners have no fixed address). Set **TTL** to end one year from today.
6. Select **Continue to summary**, check it shows only the Kinmeet account, then **Create Token**. Copy the token once; it is not shown again.

### 2. Create the GitHub environments

In https://github.com/Kinmeet/platform/settings/environments:

1. **New environment** named `staging`.
   - Under **Deployment branches and tags**, choose **Selected branches and tags** and add the branch rule `main`.
   - Under **Environment secrets**, **Add environment secret**: name `CLOUDFLARE_API_TOKEN`, value the token.
2. **New environment** named `live`.
   - Tick **Required reviewers** and add `MattA-Official`. Leave **Prevent self-review** unticked, so Matt can approve releases they publish.
   - Under **Deployment branches and tags**, choose **Selected branches and tags** and add the tag rule `v*`.
   - Add the same `CLOUDFLARE_API_TOKEN` environment secret.

Do not add the token as a repository secret.

## Rolling back

Publish a new release from the last good tag, or in the Cloudflare dashboard open the Worker, go to **Deployments** and roll back to the previous version.
