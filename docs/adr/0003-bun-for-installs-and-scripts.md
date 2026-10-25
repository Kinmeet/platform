# ADR-0003: Bun for installs and scripts

- **Status:** Accepted
- **Date:** 25 October 2026
- **Author:** Theo Marsh (Tech Lead)
- **Reviewers:** Priya Nandakumar (Engineering Manager, Platform)
- **Related:** issues #2 and #3; handbook section 2 (fixed facts); [ADR-0002](0002-project-structure.md); Sprint 0 research notes

## Context

The team needs one package manager and script runner, so that installs can be repeated exactly, CI matches what contributors run, and there is one lockfile to review. The founder decided on 25 October 2026 that the platform uses Bun, not npm or pnpm.

Bun can also be a JavaScript runtime. Our build and test tools (the Nuxt build, Vitest with the Cloudflare Workers pool, and Wrangler) are developed and tested against Node, and the deployed code runs in workerd, not in Bun or Node.

## Decision

- **Bun 1.4.4** installs packages and runs scripts. The version is pinned in `package.json` (`packageManager` and `engines`), and CI reads it from there.
- **`bun.lock` is the only lockfile.** CI installs with `bun install --frozen-lockfile`. No `package-lock.json`, `pnpm-lock.yaml` or `yarn.lock`.
- **Tools keep running on Node 24.** `bun run <script>` starts each tool through its own `node` shebang, so the Nuxt build, Vitest and Wrangler run on Node 24, which CI installs beside Bun. Tested locally and in CI on #34.
- **Small repository scripts** (for example `scripts/check-copy.ts`) and the Claude Code hooks may run directly on Bun, since they use only standard `node:` modules.
- **TypeScript is pinned to 6.0.3.** The research notes found that `vue-tsc` and `typescript-eslint` do not support TypeScript 7 yet.
- **Always `bun run test`, never `bun test`.** `bun test` starts Bun's own test runner, which would skip our Vitest suite and the Workers runtime.

## Options considered

| Option                                               | For                                                                                             | Against                                                                                   |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Bun for installs and scripts, tools on Node (chosen) | The founder's choice; fast installs; one lockfile; tools stay on the runtime they are tested on | Two runtimes in CI; `bun test` is an easy mistake                                         |
| Bun as the runtime for every tool (`bun --bun`)      | One runtime                                                                                     | Nuxt, Vitest pool and Wrangler are not tested against it; harder to debug for a successor |
| pnpm or npm                                          | Most familiar                                                                                   | Not what the founder decided                                                              |

## Consequences

- Contributors need both Bun and Node 24 installed. The development setup runbook must say so.
- Upgrading Bun means changing `packageManager` and `engines` together and regenerating `bun.lock` with `bun install`, never by hand.
- If a tool stops working through `bun run`, fix it within this setup or write a new ADR. Do not quietly switch package managers.

## Sources

- Bun install and lockfile: https://bun.sh/docs/cli/install and https://bun.sh/docs/install/lockfile (checked 25 October 2026)
- `bun run` respects a tool's `node` shebang by default: https://bun.sh/docs/cli/run (checked 25 October 2026)
- Sprint 0 research notes (versions): `docs/research/sprint-0.md`
