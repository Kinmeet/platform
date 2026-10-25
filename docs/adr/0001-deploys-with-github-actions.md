# ADR-0001: Deploy with GitHub Actions, gated on CI and Matt's approval

- Status: proposed
- Date: 25 October 2026
- Author: Jun Okafor (DevOps Engineer)
- Ticket: #8

## Context

The handbook says staging deploys are automatic and live releases need Matt's approval. P5 says API tokens are scoped to one job each, secrets are kept per environment, and the repository is public. The Kinmeet Cloudflare account (`0fa695ccf43f64b3eb9fae94520109b4`) is the only account we may deploy to.

We looked at two ways to deploy the Worker:

1. **GitHub Actions** running `wrangler deploy`, with a Cloudflare API token stored as a GitHub secret.
2. **Cloudflare Workers Builds**, where Cloudflare's GitHub app watches the repository and builds and deploys on push.

| | GitHub Actions | Workers Builds |
| --- | --- | --- |
| Deploy only after CI passes | Yes, the deploy runs after the CI workflow succeeds | No, it builds on push whatever CI says |
| Matt approves live releases | Yes, a GitHub environment with Matt as required reviewer | No built-in approval step |
| Token | One account-owned token we create, scoped to the Kinmeet account and the products we use | Cloudflare creates a broad token for us by default |
| Everything in one place | Workflows, checks and approvals all in the repository, readable by anyone | Build settings live in the Cloudflare dashboard |
| Cost | Free for a public repository | Free tier has a monthly build limit |
| Setup for Matt | Create one token, two GitHub environments | Install the Cloudflare GitHub app, configure in the dashboard |

## Decision

Use GitHub Actions (`.github/workflows/deploy.yml`).

- **Staging:** when the `CI` workflow passes on a push to `main`, the `staging` job builds that exact commit, applies D1 migrations to `kinmeet-staging`, and runs `wrangler deploy --env staging`.
- **Live:** publishing a GitHub release starts the `live` job. It waits for Matt to approve it in the `live` environment, then checks the release commit is on `main` and that CI passed on it, and deploys with `wrangler deploy --env live`.
- **After every deploy** `scripts/check-deployed.sh` loads the site and checks it returns 200 and sends the P5 security headers. This runs on GitHub's runners because the team's own sessions cannot reach `workers.dev`.
- **Token:** one account-owned API token, restricted to the Kinmeet account, with only Workers Scripts, D1, Workers KV Storage and Workers R2 Storage (all Edit) plus Account Settings (Read). It is stored as an **environment secret** called `CLOUDFLARE_API_TOKEN` in the `staging` and `live` environments, not as a repository secret, so pull request runs never see it. The account id is not a secret and is written in the workflow.
- **Environments:** `staging` deploys only from `main`; `live` deploys only from release tags (`v*`) and needs Matt's approval.
- Actions are pinned to full commit SHAs with the version in a comment.

## Consequences

- Nothing reaches staging unless CI is green, and nothing reaches live without Matt pressing approve.
- Matt has to create the token and the two environments once (steps in `docs/deploys.md`). Until they do, the deploy jobs fail at the deploy step and nothing is deployed.
- The token is long-lived. We will set it to expire after a year and add a reminder to rotate it.
- If the `CI` workflow is renamed, `deploy.yml` must be updated to match.
- A rollback is either a new release of an older tag, or `wrangler rollback` run by Matt from the dashboard or a terminal.
