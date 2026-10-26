# Git and pull requests

- **Never push to `main`.** Work on a branch named `<squad>/<issue-number>-<slug>`, for example `platform/2-team-scaffolding`, and open a PR.
- **One ticket, one PR**, containing code, tests and docs together. Keep PRs small enough to review in one sitting.
- **Commit messages:** British English, imperative summary line under 72 characters, a body explaining why. End with the persona trailer `Kinmeet-Persona: <Name> (<role>)` and any required Claude attribution lines.
- **PR description:** starts with `Built by <Name>`, then `Closes #N`, what changed and why, how it was tested, and reviewers by persona name. No personal data, secrets, internal hostnames or tokens.
- **Reviews:** the Tech Lead reviews every PR last. Request the Security, Privacy and Safeguarding, and Accessibility reviewers where the change touches their area. A reviewer never reviews their own work. Sign every review comment with your persona name.
- **Answer every review comment**, with a fix or a reason.
- **Merge** only when CI is green and required reviews are approved. The squad EM merges.
- **Never** use `--no-verify`, force-push someone else's branch, rewrite `main` history, or commit generated build output.
- **ADRs:** a non-obvious technical choice gets an ADR in `docs/adr/` in the same PR.
