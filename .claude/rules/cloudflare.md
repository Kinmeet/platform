# Cloudflare

- **Only touch the Kinmeet account, `0fa695ccf43f64b3eb9fae94520109b4`.** The Cloudflare connection can see other accounts; never read from or write to them. Pass `account_id` explicitly on every API or MCP call, and set `account_id` in the `wrangler` config.
- **Environments:** `staging` and `live`, each with its own Worker, D1 databases, R2 buckets, KV namespaces, secrets and Access policies. Staging never holds real personal data.
- **Data stays in Europe:** D1 databases use the Western Europe location hint; R2 buckets use the EU jurisdiction.
- **Deploys:** merge to `main` deploys staging. Live deploys come only from a tagged release after the founder approves. Never run `wrangler deploy --env live` by hand.
- **Database changes** only through versioned D1 migrations, applied to staging first. Use the `kinmeet-new-migration` skill.
- **Keep Cloudflare script injection off** (Web Analytics, Rocket Loader, Email Obfuscation, Zaraz and similar). They would add third-party or inline scripts and break the no-tracking rule.
- **Secrets** via `wrangler secret put --env <env>`; never in `wrangler` config `vars`.
- **Bindings** are typed: regenerate types with `wrangler types` after changing the `wrangler` config, and commit the result.
- Check current Cloudflare documentation (the docs tool or `docs/research/`) before relying on remembered behaviour; the platform changes quickly.
