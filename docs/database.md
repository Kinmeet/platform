# Main database (`DB`)

The main D1 database, bound to the Worker as `DB`. Its migrations live in `migrations/db/` ([ADR-0002](adr/0002-project-structure.md)); add new ones with the `kinmeet-new-migration` skill. Safeguarding and vault data get their own databases: the interim safeguarding store is described in [Interim safeguarding store](#interim-safeguarding-store-safeguarding_db) below, and the encrypted records come at M2c.

## Conventions

- `STRICT` tables, random UUID primary keys, `CHECK` constraints for choices and lengths.
- Times are `INTEGER` Unix-epoch seconds in UTC.
- Every personal-data row has a `delete_after` set when it is stored. The deletion job (#31) removes rows whose `delete_after` has passed, and each table has an index on it. The dates are worked out in `server/utils/retention.ts`.
- Nothing about the connection is stored: no IP address, user agent or Turnstile token (P3).

## Tables

| Table            | Holds                                                                                                                                                                        | `delete_after` (P3)                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `hello_messages` | Say hello: call name, email, message, `submission_id`, `received_at`, `replied_at`                                                                                           | 12 months after receipt on insert; each reply moves it to 12 months after that reply                            |
| `applications`   | Stage 1 role applications: role, call name, email, step 3 answers (JSON object), the `connection_to_founders` answer only, `submission_id`, `received_at`, `outcome_told_at` | 6 months after the round closes on insert (proposed backstop); 6 months after the outcome is told once recorded |
| `email_log`      | Email sending log: an HMAC of the address (never the address), template id, `sent_at`                                                                                        | 30 days after sending                                                                                           |

`submission_id` is the form's idempotency key ([forms contract](api/forms.md)). It is unique and lives on the row, so it is deleted with the row.

`audit_log` entries for "Pass to safeguarding" (`pass_to_safeguarding`) hold the date, who acted, the action and the row id, never anything from the row (#36).

## Interim safeguarding store (`SAFEGUARDING_DB`)

A separate D1 database, never the main `DB`, with its migrations in `migrations/safeguarding/`. It exists under the founder's decision of 26 October 2026 (#36): a temporary, recorded exception to SG6 and P5 until the encrypted concern record (S4, M2c). Ezra's and Nadia's conditions on #36 apply in full.

| Table               | Holds                                                                                                                                 | `delete_after`                                                           |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `handed_over_items` | What "Pass to safeguarding" handed over: the submission as it was sent (JSON), the form it came from, `received_at`, `handed_over_at` | None. Retention is set by area 2; the store is removed at the M2c sunset |

- **Behind an interface.** `server/safeguarding/store.ts` defines the store as `insert`, `readBack`, `list` and `get`, with a D1 implementation. If the safeguarding databases move to their own Cloudflare account (#95), a service-binding implementation replaces it in `storeFromEnv` alone. No disclosure goes into the store until #95 is done.
- **Only `server/safeguarding/` may use the binding.** A unit test fails if `SAFEGUARDING_DB` is named anywhere except `server/safeguarding/store.ts`.
- **Insert only.** Triggers refuse every `UPDATE` and `DELETE`. Removal happens only at the M2c sunset, by a reviewed one-off migration, and then the database itself is deleted (deleting it is what ends its Time Travel history).
- **The hand-over** copies the row into the store, reads the copy back and checks it, then deletes the row from the main database and writes the audit entry in one batch. A failure part-way leaves the row in the main database, visible and retryable. The row id is the item id, so a retry finds the copy it already made.
- **The admin role writes only.** The hand-over route replies `{ ok: true }` and nothing else, with `Cache-Control: no-store`. The acting lead's read view, with its own Access application, reader check and read log, is separate work.
- **Time Travel:** after a hand-over the message still exists in the main database's Time Travel history for its retention window. Restoring the main database to a point before a hand-over would bring the message back into the general view, so any restore must re-check hand-overs.
- **No other copies:** never export, back up or query `kinmeet-*-safeguarding` outside the app. Agents must never touch the live one (Platform #89).
