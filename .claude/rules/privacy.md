# Privacy

Source documents: P3 Data map and retention, P4 Roles and access matrix, P6 DPIA, P9 Privacy notice. Area 5 owns the final retention rules and area 2 the safeguarding ones.

- **Collect the minimum.** Every field you add must map to a row in P3. If it does not, stop and ask the Head of Delivery; do not add a new kind of personal data on your own.
- **Never store** IP addresses with form submissions, analytics of any kind, copies of DBS certificates, or survey answers linked to people.
- **Every personal-data table has a retention rule.** Add the column the deletion job needs (for example `decided_at`, `last_reply_at`) and a test that the job deletes or anonymises the row when its period ends.
- **Access follows P4.** Every read and write of personal data goes through a role check on the server. Sensitive reads and changes (volunteer records, DBS outcomes, safeguarding items, money, roles) write to the append-only audit log.
- **No personal data in logs.** Workers Logs carry errors only. Log ids, never names, emails, messages or tokens.
- **Staging holds made-up data only.** Never copy live data to staging or to a developer machine. Break-glass access to live data follows P7.
- **Public pages show organisers and trustees by role title and community name only.** No legal names, faces or addresses.
- **Children writing in** (under-13s on forms or mailing lists): follow area 5's rule; until it exists, raise it as a question rather than guessing.
- Use the `kinmeet-privacy-check` skill on any change that touches personal data.
