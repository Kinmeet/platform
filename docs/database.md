# Main database (`DB`)

The main D1 database, bound to the Worker as `DB`. Its migrations live in `migrations/db/` ([ADR-0002](adr/0002-project-structure.md)); add new ones with the `kinmeet-new-migration` skill. Safeguarding and vault data get their own databases later (M2c).

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

## Deletion job

`server/tasks/retention/delete-expired.ts` runs daily at 03:17 UTC (the cron is in both `nuxt.config.ts` and `wrangler.jsonc`, and a test checks they match). It deletes every row in the three tables whose `delete_after` has passed, in one batch, and logs counts only (`{"code":"deletion_done","deleted":{...}}`). A row is deleted at most about a day after its date.

To run it locally: `bun run build`, then `bunx wrangler dev --test-scheduled` and open `/__scheduled?cron=17+3+*+*+*`.
