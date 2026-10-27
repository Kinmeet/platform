# Architecture decision records

An architecture decision record (ADR) explains one non-obvious technical choice: what we decided, why, and what it costs us. They let someone joining later, or a future maintainer (P7), understand the platform without asking.

## When to write one

Write an ADR in the same pull request as the change when you:

- choose between real alternatives (a library, a service, a storage pattern, a deploy route);
- add a new database, bucket, Worker or outside service;
- depart from a convention in `CLAUDE.md` or an earlier ADR;
- make a choice a reviewer asked you to justify.

Do not write one for choices already made in the F, SG, S and P documents. Link to them instead.

## How

1. Copy [template.md](template.md) to `NNNN-short-title.md`, using the next number.
2. Fill it in briefly. Most ADRs fit on one screen.
3. Set the status to **Proposed**. The Tech Lead marks it **Accepted** when the PR merges.
4. Never rewrite an accepted ADR's decision. To change course, write a new ADR and mark the old one **Superseded by ADR-NNNN**.

## Index

| Number                                         | Title                                                                | Status   |
| ---------------------------------------------- | -------------------------------------------------------------------- | -------- |
| [0001](0001-deploys-with-workers-builds.md)    | Deploys with Workers Builds and Worker Previews                      | Accepted |
| [0002](0002-project-structure.md)              | Project structure                                                    | Accepted |
| [0003](0003-bun-for-installs-and-scripts.md)   | Bun for installs and scripts                                         | Accepted |
| [0004](0004-nonce-based-csp.md)                | Nonce-based CSP for Nuxt's inline scripts                            | Proposed |
| [0006](0006-email-sending.md)                  | Fixed-template email with a capture sink until we have a domain      | Proposed |
| [0007](0007-self-hosted-fonts.md)              | Self-hosted fonts from Fontsource                                    | Accepted |
| [0008](0008-worker-entry-in-front-of-nitro.md) | A Worker entry in front of Nitro for request body limits             | Proposed |
| [0009](0009-adopt-nuxthub.md)                  | Adopt NuxtHub, keeping our Worker entry, environments and migrations | Accepted |
