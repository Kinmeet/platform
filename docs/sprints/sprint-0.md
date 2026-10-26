# Sprint 0: platform skeleton

- Squad: Platform (EM: Priya Nandakumar)
- Started: 25 October 2026
- Goal: a Nuxt app deploys to a staging Worker on `kinmeet.workers.dev`, with every handbook rule enforced by tooling.

## Definition of done

- [ ] The staging Worker serves the placeholder page with all the security headers (checked by `Check deployed site` after the first Workers Builds deploy).
- [x] CI is green on `main`, including the no-third-party test and the accessibility scan (#38).
- [x] `CLAUDE.md`, rules, hooks and skills exist (#26) and were used in a review (`kinmeet-pr-review` on #34).
- [x] This file has a retro.

## Tickets

| Ticket | What                                                       | Owner    | PR       | State     |
| ------ | ---------------------------------------------------------- | -------- | -------- | --------- |
| #1     | Repository basics: templates, `SECURITY.md`                | Priya    | #35      | Merged    |
| #2     | Team scaffolding: `CLAUDE.md`, rules, hooks, skills        | Theo     | #26      | Merged    |
| #3, #5 | Nuxt skeleton, security headers, CI                        | Priya    | #34      | Merged    |
| #4     | Environments: staging, Previews, live, EU bindings         | Jun      | #39      | Merged    |
| #6     | No-third-party test, Cloudflare injection check            | Kit, Jun | #38, #42 | Merged    |
| #7     | Accessibility scan                                         | Kit      | #38      | Merged    |
| #8     | Deploys with Workers Builds and Worker Previews (ADR-0001) | Jun      | #22      | Merged    |
| #9     | Research: current versions and docs                        | Ines     | #25      | In review |
| #37    | Secret scan in CI (gitleaks)                               | Jun      | #40      | Merged    |

Moved to Sprint 1: #47 (hook follow-ups), #49 (generated Worker types), #54 (refuse oversized bodies, PR #60), #55 (e2e should-fixes), #56 (D1 migrations for Previews), #61 (Zaraz check on new zones).

## Decisions made during the sprint

- Bun 1.4.4 for installs and scripts (Matt). Tools still run on Node 24 in CI.
- TypeScript 6.0.3, because TypeScript 7 is not yet supported by `vue-tsc` and `typescript-eslint`.
- Per-request nonce CSP (ADR-0004). The P5 wording change goes to Matt at the M1 review.
- Deploys through Workers Builds with no Cloudflare token in GitHub. Live builds only from the protected `live` branch (ADR-0001, Matt and Rowan).
- All D1, KV and R2 resources use jurisdiction `eu`.

## Risks

- The team's sessions cannot reach `workers.dev`, so headers on deployed sites are only checked from GitHub runners.
- `wrangler d1 migrations apply` does not target Previews yet (#56). This matters from the first migration.
- Previews and staging are public until Cloudflare Access is on. Matt has to turn on Zero Trust first.

## Retro

### Went well

- Reviews caught real problems before merge: the nonce leaking onto body tags, passkeys being blocked, bypasses in the commit hook, and the safeguarding link in the issue template.
- Checking current docs early saved rework, for example the renamed Vitest plugin, TypeScript 7 support, and Worker Previews replacing preview aliases.
- The change of deploy route was cheap because no deploy job had merged yet.

### To change

- **Merge one at a time.** `main` requires an up-to-date branch, and several squads merge at once, so PRs went stale repeatedly. Agreed: merge one PR at a time and merge `main` in rather than force-pushing after approval (added to `.claude/rules/git-and-prs.md`). We'll ask Matt to allow auto-merge or a merge queue.
- **Labels are replaced, not added**, when set through the GitHub tools. Added to the same rule.
- **Messages between threads ran out.** The shared hourly limit was hit twice. Agreed: routine status goes on the PR or issue, and messages to other threads are batched into one stand-up to the Head of Delivery.
- **Format everything CI formats.** A YAML template written before Prettier covered `.github/` failed CI after the merge. The format hook from #26 now runs on every file written, so this should not recur.
- **Final reviews lagged behind EM reviews.** #39 and #22 merged on the EM's review so Matt could connect Workers Builds, and the tech lead read them after merge (no findings). From Sprint 1, ask for the tech lead's review when the PR opens, not after the EM's.
