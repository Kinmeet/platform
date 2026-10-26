---
name: kinmeet-new-migration
description: Add or change a Kinmeet D1 database schema safely with a versioned Wrangler migration. Use whenever a change needs a new table, column, index or data fix in D1.
---

# Kinmeet new D1 migration

Database changes happen only through versioned migrations in `migrations/<binding>/`, one folder per D1 binding (see ADR-0002). They run on staging first, then live with the release.

## 1. Before writing SQL

- Check the data against the data map with `kinmeet-privacy-check` if it holds personal data. No new kind of personal data without a decision.
- Decide the retention timestamp the deletion job will use (for example `created_at`, `decided_at`, `left_at`).
- Sensitive fields (P5) are stored as ciphertext: use `BLOB` or `TEXT` columns named `*_ciphertext`, never plain values.

## 2. Create the migration

```sh
bunx wrangler d1 migrations create <database-name> <short_snake_case_description> --env staging
```

This creates the next numbered file (for example `0003_add_hello_messages.sql`) in the binding's `migrations_dir`. Never rename, reorder or edit a migration that has been merged; write a new one.

## 3. Write the SQL

- Start with a comment saying what the migration does and why, in British English.
- Use `STRICT` tables, explicit `NOT NULL`, `CHECK` constraints for enums, and `INTEGER` Unix-epoch seconds or ISO 8601 `TEXT` for times (follow the existing convention in the folder).
- Primary keys are random ids (for example `TEXT` UUIDs), never sequential numbers exposed in URLs.
- Add indexes for the columns the deletion job and common queries filter on.
- Changing a column in SQLite means create-new, copy, drop, rename. Do it in one migration and keep the data.
- Destructive steps (dropping a table or column with data) need a note in the PR and the EM's agreement.
- No seed data with anything that looks like a real person.

## 4. Test it

- Unit tests apply migrations in setup (`applyD1Migrations` with the Workers pool), so a broken migration fails CI.
- Add tests for constraints and for the retention job on any personal-data table.
- Apply locally: `bunx wrangler d1 migrations apply <database-name> --local --env staging`.

## 5. Ship it

- Regenerate binding types with `bunx wrangler types` if bindings changed.
- Staging migrations run with the staging deploy after merge. Live migrations run only with an approved tagged release; never apply them to live by hand.
- If the migration needs a decision record (new database, new storage pattern), add an ADR.
