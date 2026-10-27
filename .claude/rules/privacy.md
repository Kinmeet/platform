# Privacy

Source documents: P3 Data map and retention, P4 Roles and access matrix, P6 DPIA, P9 Privacy notice. Area 5 owns the final retention rules and area 2 the safeguarding ones.

- **Collect the minimum.** Every field you add must map to a row in P3. If it does not, stop and ask the Head of Delivery; do not add a new kind of personal data on your own.
- **Never store** IP addresses with form submissions, analytics of any kind, copies of DBS certificates, or survey answers linked to people.
- **Never send IP addresses out either:** do not pass the optional `remoteip` to Turnstile siteverify.
- **Every personal-data table has a retention rule.** Add the column the deletion job needs (for example `decided_at`, `last_reply_at`) and a test that the job deletes or anonymises the row when its period ends.
- **Every row gets a deletion date when it is stored**, even if the P3 trigger (a reply, a decision) never happens. Unanswered or undecided rows must not live forever.
- **Access follows P4.** Every read and write of personal data goes through a role check on the server. Sensitive reads and changes (volunteer records, DBS outcomes, safeguarding items, money, roles) write to the append-only audit log.
- **No personal data in logs.** Workers Logs and observability keep no request headers (`CF-Connecting-IP`, `User-Agent`) or bodies; errors log a code and ids only, never names, emails, messages or tokens.
- **Staging holds made-up data only.** Never copy live data to staging or to a developer machine. Break-glass access to live data follows P7.
- **Live D1 stays on Cloudflare (#111).** On a live database (`--env live`, `kinmeet-live` or its id), agents may run only `wrangler d1 migrations list` and `wrangler d1 info`, or `GET` its details through the D1 API. Remote `execute`, `export`, `time-travel` and `migrations apply`, the API `query`, `raw`, `export` and `import` paths, and any write are refused by the Bash and Cloudflare hooks. Live migrations run only from the live Workers Build. The hooks are a safety net; this rule is the control until the founder decides otherwise.
- **Anywhere public** (pages, this repository, issues, PRs, commit messages): organisers, trustees and the founder appear by role title and community name only. No legal names, faces or addresses.
- **Links** in the repository never point to anything that holds personal data.
- **Safeguarding (SG6):** any free-text route (forms, messages, comments) needs a way to pass a disclosure to the safeguarding lead and remove the general copy. Safeguarding items are visible to the lead and deputy only.
- **Children writing in** (under-13s on forms or mailing lists): follow area 5's rule; until it exists, raise it as a question rather than guessing.
- Use the `kinmeet-privacy-check` skill on any change that touches personal data.
