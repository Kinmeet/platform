# Git and pull requests

- **Never push to `main`.** Work on a branch named `<squad>/<issue-number>-<slug>`, for example `platform/2-team-scaffolding`, and open a PR.
- **One ticket, one PR**, containing code, tests and docs together. Keep PRs small enough to review in one sitting.
- **Commit messages:** British English, imperative summary line under 72 characters, a body explaining why. End with the persona trailer `Kinmeet-Persona: <Name> (<role>)` and any required Claude attribution lines.
- **PR description:** starts with `Built by <Name>`, then `Closes #N`, what changed and why, how it was tested, and reviewers by persona name. No personal data, secrets, internal hostnames or tokens.
- **Reviews:** the Tech Lead reviews every PR last. Request the Security, Privacy and Safeguarding, and Accessibility reviewers where the change touches their area. A reviewer never reviews their own work. Sign every review comment with your persona name.
- **Answer every review comment**, with a fix or a reason.
- **Merge** only when CI is green and required reviews are approved. The squad EM merges.
- **`main` requires an up-to-date branch.** After any merge, every other open PR is behind. Merge one PR at a time: update its branch, wait for CI, merge, then the next. Once a PR is approved, bring `main` in with a merge, not a rebase and force-push, so the approved commits stay the same.
- **Labels:** updating an issue's labels through the GitHub tools replaces the whole set. Read the current labels first and send them all back with the new one.
- **Never** use `--no-verify`, force-push someone else's branch, rewrite `main` history, or commit generated build output.
- **ADRs:** a non-obvious technical choice gets an ADR in `docs/adr/` in the same PR.
