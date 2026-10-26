# Main database (`DB`)

The main D1 database, bound to the Worker as `DB`. Its migrations live in `migrations/db/` ([ADR-0002](adr/0002-project-structure.md)); add new ones with the `kinmeet-new-migration` skill. The interim safeguarding store is a table of ciphertext in this database ([below](#interim-safeguarding-store-safeguarding_items)); the vault and the M2c safeguarding records come later.

## Conventions

- `STRICT` tables, random UUID primary keys, `CHECK` constraints for choices and lengths.
- Times are `INTEGER` Unix-epoch seconds in UTC.
- Every personal-data row has a `delete_after` set when it is stored. The deletion job (#31) removes rows whose `delete_after` has passed, and each table has an index on it. The dates are worked out in `server/utils/retention.ts`.
- Nothing about the connection is stored: no IP address, user agent or Turnstile token (P3).

## Tables

| Table            | Holds                                                                                                                                                                                                                                                                                                                                 | `delete_after` (P3)                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hello_messages` | Say hello: call name, email, message, `submission_id`, `received_at`, `replied_at`                                                                                                                                                                                                                                                    | 12 months after receipt on insert; each reply moves it to 12 months after that reply                            |
| `applications`   | Stage 1 role applications: role, call name, email, step 3 answers (JSON object), the `connection_to_founders` answer only, `submission_id`, `received_at`, `outcome_told_at`                                                                                                                                                          | 6 months after the round closes on insert (proposed backstop); 6 months after the outcome is told once recorded |
| `email_log`      | Email sending log: an HMAC of the address (never the address), template id, `sent_at`                                                                                                                                                                                                                                                 | 30 days after sending                                                                                           |
| `audit_log`      | Admin actions, list views and safeguarding hand-overs and openings (P4, P5): when, the Cloudflare Access user id (`sub`, never a name or email), the action and the target row's table and id (no id for a list view); never anything from the row. Append-only: triggers refuse every update, and every delete before `delete_after` | 2 years after the action (Phase 1 rule, pending a P3 row)                                                       |

`submission_id` is the form's idempotency key ([forms contract](api/forms.md)). It is unique and lives on the row, so it is deleted with the row.

## Deletion job

`server/tasks/retention/delete-expired.ts` runs daily at 03:17 UTC (the cron is in both `nuxt.config.ts` and `wrangler.jsonc`, and a test checks they match). It deletes every row in `hello_messages`, `applications`, `email_log` and `audit_log` whose `delete_after` has passed, in one batch, and logs counts only (`{"code":"deletion_done","deleted":{...}}`). A row is deleted at most about a day after its date. Audit log entries are deleted only once their date has also passed by the database's own clock, which their append-only trigger checks.

A run that cannot delete (no `DB` binding, or a D1 error) logs `deletion_db_missing` or `deletion_failed` and then throws, so the cron run shows as an exception in Workers Logs and the Worker's cron history rather than as a success.

The job uses Nitro's scheduled tasks, which are still experimental (`experimental: { tasks: true }` in `nuxt.config.ts`). If an upgrade breaks them, the fallback is a plain `scheduled` handler in the Worker entry (`worker/index.mjs`, ADR-0008) that calls `deleteExpiredRows` with the `DB` binding.

To run it locally: `bun run build`, then `bunx wrangler dev --test-scheduled` and open `/__scheduled?cron=17+3+*+*+*`. CI does the same on every pull request: `tests/e2e/deletion-job.spec.ts` seeds rows past and before their date in each table, runs the job through `/__scheduled` and checks only the expired rows are gone. The end-to-end server keeps its local data in `.wrangler/e2e-state`, emptied and migrated before each run.

### Copies outside the tables

Deleting a row does not remove it from every copy at once:

- **D1 Time Travel** keeps point-in-time history of the database for its retention window (up to 30 days, depending on plan). A deleted row can stay there for that long. We only ever restore from Time Travel to recover from a failure. After a restore, nobody uses the data until the deletion job has run again.
- **Backups** (P2, a later ticket) will hold copies too. Each backup must be kept for no longer than the shortest P3 period it covers, or the deletion job must be re-run after any restore from it.

## Interim safeguarding store (`safeguarding_items`)

A table in this database that only ever holds ciphertext (#36, #95). It exists under the founder's decision of 26 October 2026: a temporary, recorded exception to SG6 and P5 until the encrypted concern record readable only by the lead and deputy (S4, M2c). Nadia's and Ezra's conditions on #95 apply in full.

| Table                | Holds in clear                                                                 | `delete_after`                                                                                      |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `safeguarding_items` | `id`, `key_version`, `iv`, `ciphertext` and `handed_over_at`, and nothing else | None. Retention is area 2's to set; the deletion job never touches this table, and a test checks it |

- **Encrypted in the Worker.** `server/safeguarding/crypto.ts` uses AES-256-GCM from Web Crypto, with a random 96-bit IV for every record and additional authenticated data binding the record id and key version, so a row's ciphertext cannot be moved to another row or relabelled. Inside the ciphertext: the submission as it was sent (call name, email, message or answers), the form it came from and when it arrived. So D1, Time Travel, exports and backups never show who raised a concern.
- **The key** is the Worker secret `SAFEGUARDING_KEY` ([environments.md](environments.md#secrets)), imported as non-extractable. Without a usable key the store is not set up and "Pass to safeguarding" answers `503`, moving nothing.
- **Behind an interface.** `server/safeguarding/store.ts` is the only code that reads the key, and only `server/safeguarding/` names the table; a unit test checks both. The interface is `insert`, `readBack` (decrypts, for the hand-over's check only), `list` (ids and hand-over times only) and `open` for the acting lead's view (#93), which writes an `open_safeguarding_item` audit entry **before** it decrypts anything.
- **Insert only.** Triggers refuse every `DELETE`, and every `UPDATE` except re-encrypting a record under a newer key version during a key rotation ([runbook](runbooks/rotate-safeguarding-key.md)).
- **The hand-over** is insert, then verify, then delete: it encrypts the row into the store, reads the copy back, decrypts it and checks it matches, then deletes the row from `hello_messages` or `applications` and writes the `pass_to_safeguarding` audit entry in one batch. A failure part-way leaves the row in the general list, visible and retryable. The row id is the item id, so a retry finds the copy it already made.
- **The audit entries** for a hand-over or an opening name the item (`target_table` is `safeguarding_items`), not the form it came from, and hold nothing from the row.
- **The admin role writes only.** The hand-over route replies `{ ok: true }` and nothing else, with `Cache-Control: no-store`. Errors log a code only and never carry anything from the row; a test checks the failure paths.
- **Time Travel:** after a hand-over the original message stays in the main database's Time Travel history for its retention window (7 days on the current Workers plan). Restoring to a point before a hand-over would bring it back into the general list, so any restore must re-check hand-overs.
- **No hand-over before go-live condition 6.** Until the agents' Cloudflare access is read-only, as Nadia's condition 1 on #95 requires, no real disclosure is handed over.
- **Sunset (M2c):** move every record into browser-side encryption, check each one opens, then delete the live key and its offline copy, then drop the table. In that order: destroying the key first would destroy the records.
