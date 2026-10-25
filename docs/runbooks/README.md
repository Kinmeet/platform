# Runbooks

Step-by-step procedures for running and recovering the platform. They exist so that someone new can keep Kinmeet running without the original developer (P7 Continuity and handover).

Every runbook is written so that a capable volunteer who has never seen the code can follow it. Each one lists who may carry it out, what access it needs, the exact steps, how to check it worked, and how to undo it.

**Never** put secrets, recovery codes or personal data in a runbook. Say where the secret is kept (for example "the sealed offline record" or "Worker secret `NAME` in the staging environment"), never its value.

## Planned runbooks

Status: stub (Sprint 0). Owner: Tech Lead until the Docs Writer takes them over.

| Runbook | Covers (from P7) | Status |
| --- | --- | --- |
| `dev-setup.md` | Set up a development machine and run the app and tests locally | Planned (Sprint 0) |
| `deploy.md` | How staging and live deploys happen, and how to approve a live release | Planned (with ADR-0001) |
| `rollback.md` | Roll back a bad release to the previous Worker version (target: 1 hour) | Planned |
| `migrations.md` | Run D1 migrations on staging and live | Planned |
| `restore-backup.md` | Restore from D1 Time Travel or the latest encrypted backup, and the quarterly restore test (target: 1 day) | Planned (M2) |
| `rotate-secrets.md` | Rotate Worker secrets and API tokens, including after the sealed record is opened | Planned |
| `add-admin.md` | Add or remove an admin for Cloudflare, GitHub and Cloudflare Access | Planned |
| `break-glass.md` | Time-limited access to live data, approved by a trustee and logged, ended within 24 hours | Planned (M2) |
| `account-recovery.md` | Regain a locked or compromised Cloudflare or GitHub account using the second admin and the sealed record (target: 2 days) | Planned |
| `safeguarding-key-recovery.md` | Use the recovery key with two trustees to re-wrap safeguarding records (target: 1 week) | Planned (M2c) |

## Template

```markdown
# Title

- **Who may do this:** role
- **Access needed:** accounts or permissions, never values
- **Time needed:** rough estimate
- **Last tested:** date and by whom

## When to use this

## Before you start

## Steps

1. ...

## Check it worked

## If something goes wrong / how to undo
```
