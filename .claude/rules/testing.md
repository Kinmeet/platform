# Testing

- **Never skip, disable or weaken a test** to get green. No `.skip`, `.only`, lowered thresholds or deleted assertions. If a test is wrong, fix it in the open and say why in the PR.
- **Unit and integration tests** in `tests/unit/`, using Vitest with the Cloudflare Workers pool so they run in the real Workers runtime with D1, R2 and KV bindings. Apply D1 migrations in test setup rather than hand-building tables.
- **End-to-end tests** in `tests/e2e/` with Playwright. Every new route is covered by the no-third-party-requests test and the axe accessibility scan automatically; do not exclude routes.
- **Test data is made up and obviously fake:** names like "Test Organiser", emails at `example.com` or `example.org`, community names like "Sample Group". Never real people, real emails or real places that identify anyone.
- **Every personal-data table gets a retention test** proving the deletion job removes or anonymises rows at the end of their period.
- **Security behaviour is tested:** headers, role checks (including a denied case), Turnstile verification failure, rate limiting.
- **A bug fix starts with a failing test** that reproduces it.
- Run `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run check:copy` and `bun run test` before opening a PR. These are the same steps CI runs.
