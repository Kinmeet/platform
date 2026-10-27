# ADR-0008: A Worker entry in front of Nitro for request body limits

- **Status:** Accepted (merged in #60, 26 October 2026)
- **Date:** 26 October 2026
- **Author:** Jun Okafor (DevOps Engineer)
- **Reviewers:** Nadia Haddad (Security Reviewer), Theo Marsh (Tech Lead)
- **Related:** issue #54, P5, [docs/api/forms.md](../api/forms.md) ("Body size cap"), ADR-0001

## Context

Nitro's Cloudflare handler reads every request body fully into memory before any route code runs. So anyone can send up to Cloudflare's own request size limit to any path, and the per-form caps in the form routes run too late to stop the read.

## Decision

The deployed Worker's entry is [`worker/index.mjs`](../../worker/index.mjs), not Nitro's output. For each request it looks up the route's limit with `bodyLimitFor` in [`shared/routes.ts`](../../shared/routes.ts), then:

- refuses with `413` if `Content-Length` is over the limit;
- otherwise counts the bytes as they arrive, and refuses as soon as they pass the limit;
- hands an accepted body to Nitro unchanged.

The limits are 22 KB for `/api/hello` and 64 KB for `/api/apply`. Any other route gets no body on `GET` and `HEAD` and 1 KB on other methods. The `413` carries the same security headers as every other response, and the body is never logged.

## Options considered

| Option                                   | For                                                                   | Against                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Wrapper entry in front of Nitro (chosen) | Runs before anything reads the body; plain Workers code; easy to test | One more file in the deploy path; Wrangler bundles the Nitro output a second time        |
| Nitro middleware                         | Stays inside Nuxt                                                     | Too late: the handler has already read the body when middleware runs                     |
| WAF rule on request size                 | No code                                                               | Needs a zone, and we only have `workers.dev`; can't do per-route limits on the free plan |
| Patch Nitro's Cloudflare preset          | No wrapper                                                            | A fork to maintain through every Nuxt upgrade                                            |

## Consequences

- `wrangler.jsonc` `main` points at `worker/index.mjs`, which imports `.output/server/index.mjs`. `bun run build` must run before `wrangler deploy` or `wrangler dev`, as it already does in Workers Builds.
- Every new route that accepts a body must add its limit to `bodyLimits` in `shared/routes.ts`, or it gets only 1 KB. A form's limit there must be at least its own `bodyCapBytes`.
- Accepted bodies are held in the entry before Nitro gets them. That's at most 64 KB, so the cost is small.
- If Nitro ever exports more than `fetch` (for example `scheduled` or Durable Object classes), the entry passes them through, because it spreads Nitro's default export. Named exports would need adding by hand.

## Sources

- Nitro `cloudflare_module` preset output, checked against Nuxt 4.6.2 on 26 October 2026.
- Cloudflare Workers runtime APIs (Request, ReadableStream), developers.cloudflare.com, checked 26 October 2026.
