# Safeguarding data

Source: the founder's decisions on #36 and #95 (26 October 2026), with the conditions set by the Security Reviewer and the Privacy and Safeguarding Reviewer on #95. This is a recorded exception to SG6 and P5 until the M2c sunset.

- **The interim store is encrypted, in the main D1.** Handed-over disclosures go into the `safeguarding_items` table. Only `server/safeguarding/` encrypts them, in the Worker, with AES-256-GCM. The key is the Worker secret `SAFEGUARDING_KEY`, with `SAFEGUARDING_KEY_PREVIOUS` during a rotation. The table, D1 Time Travel and backups hold only ciphertext and nothing in clear that identifies anyone. Only the acting safeguarding lead reads records, through the audited safeguarding view.
- **Agents never touch the table on a real database.** No query, change, export or Time Travel restore aimed at `safeguarding_items` on staging, Previews or live, by `wrangler d1 --remote`, the Cloudflare API, the Cloudflare MCP tools or any script. Schema changes ship only as reviewed migrations applied by the deploy.
- **Agents never handle a safeguarding key.** The founder generates and sets the live key and keeps the offline copy. Agents never read, set, rotate or delete it, and never ask for it. Staging and Preview keys are different from live. They are generated inside the Cloudflare runtime, so no agent ever sees the value. Never use `wrangler secret` for them.
- **Code may use the table and the key.** Building and testing `server/safeguarding/` is fine. Use the Vitest Workers pool with migrations applied in test setup, never a real database. Local D1 (`--local`) holds made-up data and is fine. Only `server/safeguarding/` may name the table or read the key. The deletion job never touches the table.
- **Why:** anyone who can change the code running on live could make it decrypt. The founder accepted the interim store only on condition that agents can't do this.
- **Read-only access is the control.** Before the first public form opens (go-live condition 6, steps on #95), the founder makes the agents' Cloudflare access read-only for Workers, Workers Builds, Access and D1, and removes the old Workers Bindings connector. After that, every deploy goes through Workers Builds, and live only from the founder's `live` branch. The founder sets the live key only after the access is read-only, replacing any value already there. No disclosure is handed over until all of this is in place and verified.
- **A Time Travel restore of a live database is founder-only.** Restoring the main live D1 also rolls back or removes safeguarding records, even though the command names no table.
- **Hooks are a safety net** until then (`guard-bash.mjs` and `guard-cloudflare.mjs`, tested in `bun run test:hooks`). They refuse:
  - remote D1 commands and Cloudflare API calls that name the table;
  - `wrangler secret` commands on a safeguarding key;
  - Cloudflare calls that handle the key on anything but the literal staging Worker, `platform-staging`;
  - D1 commands on a database other than the main `DB` databases in `wrangler.jsonc`.
- **Never work around a hook.** If you think you need access, stop and tell your EM. The answer goes to the safeguarding lead, not to you.
- **At M2c**, the order is: move each record into browser-side encryption, check that every record opens, then destroy the live key and its offline copy, then drop the table.
