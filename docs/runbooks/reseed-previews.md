# Empty the shared Preview database

- **Who may do this:** any team member, or the founder
- **Access needed:** Wrangler signed in to the Kinmeet account with D1 edit
- **Time needed:** 5 minutes
- **Last tested:** not yet

## When to use this

Every Preview of the `platform` Worker, including staging (the Preview of `main`), shares the `kinmeet-staging` database. Cloudflare runs Cron Triggers on production only ([Previews, limitations](https://developers.cloudflare.com/workers/previews/resources/#limitations)), so the daily deletion job never clears it. Empty it once a month, and straight away if anything that looks like real personal data turns up there.

## Before you start

- Check you are working on `kinmeet-staging`, never `kinmeet-live`. The hooks refuse remote commands on live databases, but check anyway.
- Leave `safeguarding_items` alone. Agents never touch that table on any real database (`.claude/rules/safeguarding-data.md`). If it needs emptying, ask the founder.

## Steps

1. Empty the form tables:

   ```sh
   bunx wrangler d1 execute kinmeet-staging --remote --env staging \
     --command "DELETE FROM hello_messages; DELETE FROM applications; DELETE FROM email_log;"
   ```

2. Add any made-up rows the team needs for testing, using obviously fake data (names like "Test Organiser", emails at `example.com`).

## Check it worked

```sh
bunx wrangler d1 execute kinmeet-staging --remote --env staging \
  --command "SELECT (SELECT COUNT(*) FROM hello_messages) AS hello, (SELECT COUNT(*) FROM applications) AS applications, (SELECT COUNT(*) FROM email_log) AS email_log;"
```

Each count is 0, or the number of made-up rows you added.

## If something goes wrong / how to undo

The data is made up, so there is nothing to restore. If a migration is missing afterwards, the next build of `main` applies it (`scripts/d1-migrate.sh preview`).
