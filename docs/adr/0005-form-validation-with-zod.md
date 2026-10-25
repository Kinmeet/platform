# ADR-0005: Form validation with Zod

- **Status:** Proposed
- **Date:** 25 October 2026
- **Author:** Ade Bankole (Backend Engineer)
- **Reviewers:** Theo Marsh (Tech Lead), Nadia Haddad (Security Reviewer), Kit Morgan (Test Engineer)
- **Related:** issue #28, [forms contract](../api/forms.md), S5, P3, P5

## Context

The say hello and apply forms (#29, #30) must be validated twice: on the page, so people see problems straight away, and on the server, which never trusts the page (P5). Both checks must agree exactly, including lengths counted in Unicode code points. The API returns stable error codes, never sentences, so pages can translate them (Welsh later). `shared/` is bundled into the browser, so whatever we use there must be small and have no server-only imports. The Tech Lead chose Zod 4 on 25 October; this record writes down how we use it.

## Decision

Use Zod 4 (`zod`, pinned) for every form schema.

- Each form has `shared/forms/<form>.ts`, exporting its schema (a strict object, so unknown keys are refused) and its inferred type. Common fields live in `shared/forms/fields.ts`.
- Schemas never set messages. A rule Zod has no issue code for (too long in code points, an invalid email, `under_18`, `not_independent`) is a refinement carrying `params.code`.
- One helper, `shared/forms/errors.ts`, maps Zod issues to `{ field, code }`: one error per field, dotted paths for nested fields, and `unknown_field` for each unexpected key. An issue a person using our page could not cause (a wrong type, a malformed `submissionId`) makes the route answer `400 bad_request` instead.
- Text is trimmed before checks, and lengths are counted with `[...value].length` in both places.
- The server runs every request through one pipeline (`server/utils/forms/process.ts`) in the contract's fixed order: method, origin and content type, size cap (worked out from the schema), per-network limit, global limit, parse and validate, Turnstile, idempotency lookup, store, receipt. Validation comes before Turnstile so a malformed request never costs a siteverify call. Routes supply only the schema and storage.

## Options considered

| Option              | For                                                                                                                                                                          | Against                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Zod 4 (chosen)      | Widely used and documented; one schema gives runtime checks and TypeScript types; issue codes and paths map cleanly to our error format; works in the browser and on Workers | A dependency in the browser bundle; its default messages are English, so we must never show them (we don't) |
| Valibot             | Smaller bundle                                                                                                                                                               | Less familiar to a future volunteer maintainer (P7); not the Tech Lead's choice                             |
| Hand-written checks | No dependency                                                                                                                                                                | Two copies of every rule drift apart; no inferred types; more code to review                                |

## Consequences

- A field rule changes in one place and both checks follow. Tests cover the schemas and the error mapping directly.
- Any new error code must be added to `fieldErrorCodes` and to the contract, and pages need translated text for it.
- Zod's English messages must never reach a page or the API response; reviewers check that `errors.ts` is the only path from issues to output.
- Upgrading Zod is a reviewed change: issue codes are part of our contract through `errors.ts`, and its tests will catch a change in them.

## Sources

- Zod 4 documentation, https://zod.dev (version 4.6.5 installed and tested, 25 October 2026)
- Cloudflare Turnstile server-side validation, https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
- Workers rate limiting binding, https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
