# Admin page

`/admin` is the founder's page for say hello messages and applications (#32). It is read-only apart from two actions: **Mark replied** and **Mark outcome told**. Each records its date, moves the row's deletion date on as P3 says, and writes an entry to the append-only `audit_log` table.

## Access

- Cloudflare Access protects `/admin` and `/api/admin` on the staging and live Workers and lets only the founder through.
- The Worker checks again on every admin request (`server/middleware/admin-access.ts`): the `Cf-Access-Jwt-Assertion` token must be signed by the team's published keys, for this application's audience, from this team, and not expired. Anything else gets `403`, including missing configuration or keys that cannot be fetched.
- Actions (`POST`) must also come from this environment's own origin (`SITE_ORIGIN`).
- Locally, without Access, the admin page always answers `403`.

Each environment needs two variables, which are not secrets, once its Access application exists:

| Variable             | Value                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| `ACCESS_TEAM_DOMAIN` | The Access team domain, `<team>.cloudflareaccess.com`                        |
| `ACCESS_AUD`         | The Access application's audience (AUD) tag, from its overview in Zero Trust |

## What it shows

- Every message and application with its received date and deletion date.
- For applications, "Conflict to declare" is worked out when the row is read, from the applicant's own answer about knowing a founder (`friend_or_acquaintance` or `not_sure`). It is never stored as a flag and never counted or summarised.

## Audit log

`audit_log` holds the time, the Access user id (`sub`, an opaque id, never an email address), the action and the target row's id. It never copies anything from the row. Database triggers refuse every update and delete.
