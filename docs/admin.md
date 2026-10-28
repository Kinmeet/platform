# Admin page

`/admin` is the founder's page for say hello messages and applications (#32). It is read-only apart from two actions: **Mark replied** and **Mark outcome told**. Each records its date, moves the row's deletion date on as P3 says, and writes an entry to the append-only `audit_log` table.

## Access

- Cloudflare Access protects `/admin` and `/api/admin` on every deployed environment and lets only the founder through.
- The Worker checks again on every admin request (`server/middleware/10.admin-access.ts`, which runs after the security headers middleware so a refusal still carries the P5 headers): the `Cf-Access-Jwt-Assertion` token must be signed by the team's published keys, for this application's audience, from this team, and not expired. Anything else gets `403`, including missing configuration or keys that cannot be fetched.
- Actions (`POST`) must also come from this environment's own origin (`SITE_ORIGIN`).
- Locally, without Access, the admin page always answers `403`.

Each environment needs two variables, which are not secrets. They are set in `wrangler.jsonc` for every deployed environment, Previews included, because Previews do not inherit production vars (#125). `tests/unit/config/access.test.ts` fails if either is missing anywhere, or if two environments share an application:

| Variable             | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | The Access team domain, `<team>.cloudflareaccess.com`                        |
| `ACCESS_AUD`         | The Access application's audience (AUD) tag, from its overview in Zero Trust |

| Environment                            | Access application        |
| -------------------------------------- | ------------------------- |
| `platform` production (`env.live`)     | platform admin            |
| `platform` Previews, including staging | platform Previews         |
| Old staging Worker (`env.staging`)     | platform-staging admin    |
| Old staging Worker's Previews          | platform-staging Previews |

## What it shows

- Every message and application with its received date and deletion date.
- For applications, "Conflict to declare" is worked out when the row is read, from the applicant's own answer about knowing a founder (`friend_or_acquaintance` or `not_sure`). It is never stored as a flag and never counted or summarised.

## Audit log

`audit_log` holds the time, the Access user id (`sub`, an opaque id, never an email address), the action and the target row's id. It never copies anything from the row. Each fetch of either list is also recorded, as one `view_form_submissions` entry for each form the list shows (say hello, or each application form), because the lists show full content (Nadia and Ezra, #51). Entries from before #156 used `view_hello_messages` and `view_applications`, and are kept as they were. A view entry names the form but no rows, so the log never becomes a second index of the data. The list is read only after its view entry is written. Each entry is kept for 2 years (a Phase 1 rule, pending a P3 row) and has its own `delete_after`. Database triggers refuse every update, and refuse a delete until the entry's `delete_after` has passed, so the deletion job can remove expired entries but nothing can remove a current one.
