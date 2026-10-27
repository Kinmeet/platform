# Empty the shared Preview database

- **Who may do this:** any team member, or the founder
- **Access needed:** Wrangler signed in to the Kinmeet account with D1 edit
- **Time needed:** 5 minutes
- **Last tested:** not yet

## When to use this

Every Preview of the `platform` Worker, including staging (the Preview of `main`), shares the `kinmeet-staging` database. Cloudflare runs Cron Triggers on production only ([Previews, limitations](https://developers.cloudflare.com/workers/previews/resources/#limitations)), so the daily deletion job never clears it. Empty it once a month.

## If you find real personal data

Real data on staging means handbook rule 2 has failed, so it is an incident, not just a clean-up.

1. Stop. Don't delete anything yet, and don't copy or read the rows further.
2. Tell the Head of Delivery straight away, giving only the table and the number of rows, never the content. They tell the founder.
3. If it could be a disclosure of harm, the founder, as acting safeguarding lead, decides what happens before anything is deleted.
4. Empty the tables with the steps below only when the Head of Delivery says so.

## Before you start

- The commands name the shared Preview database, `kinmeet-staging`, by name and use `wrangler.preview-migrations.jsonc`, so they don't depend on a Wrangler environment. Never point them at `kinmeet-live`. The hooks refuse remote commands on live databases, but check anyway.
- Leave `safeguarding_items` alone. Agents never touch that table on any real database (`.claude/rules/safeguarding-data.md`). If it needs emptying, ask the founder.

## Steps

1. Empty the form tables:

   ```sh
   bunx wrangler d1 execute kinmeet-staging --remote \
     --config wrangler.preview-migrations.jsonc \
     --command "DELETE FROM hello_messages; DELETE FROM applications; DELETE FROM email_log;"
   ```

2. Add any made-up rows the team needs for testing, using obviously fake data (names like "Test Organiser", emails at `example.com`).

## Check it worked

```sh
bunx wrangler d1 execute kinmeet-staging --remote \
  --config wrangler.preview-migrations.jsonc \
  --command "SELECT (SELECT COUNT(*) FROM hello_messages) AS hello, (SELECT COUNT(*) FROM applications) AS applications, (SELECT COUNT(*) FROM email_log) AS email_log;"
```

Each count is 0, or the number of made-up rows you added.

## If something goes wrong / how to undo

The data is made up, so there is nothing to restore. If a migration is missing afterwards, the next build of `main` applies it (`scripts/d1-migrate.sh preview`).
