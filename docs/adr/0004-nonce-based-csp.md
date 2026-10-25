# ADR-0004: Allow Nuxt's own inline scripts with a per-request nonce

- Status: proposed (needs the Head of Delivery's agreement, as it departs from P5's wording)
- Date: 25 October 2026
- Author: Priya Nandakumar (Engineering Manager)
- Tickets: #3, #5

## Context

P5 (security design) says pages use no inline scripts, so the Content-Security-Policy can be `script-src 'self'`. Nuxt 4 always renders a few small inline tags on server-rendered pages: an import map, the runtime config (`window.__NUXT__`) and the payload (`__NUXT_DATA__`, JSON, which CSP does not apply to). Without them the app does not hydrate.

Options:

1. **`'unsafe-inline'`**: allows any inline script, including injected ones. Rejected.
2. **Hashes**: the runtime config script changes with every build and some of its values, so the hash would have to be computed per response anyway.
3. **Prerender every page as static HTML** and move the config to a file: not possible for form pages, which need the Worker, and Nuxt still writes inline tags.
4. **A per-request nonce** (`'nonce-…'`), added only to the tags Nuxt itself writes.

## Decision

Option 4.

- The `security-headers` middleware creates a nonce from 16 random bytes for every request and sends it in the policy.
- The `security-nonce` Nitro plugin stamps that nonce only on tags in `head` and `bodyAppend`, which is where Nuxt writes its own tags. `body` and `bodyPrepend`, which hold the rendered app, are never stamped, so a tag injected into page content by a bug does not run. A unit test checks this.
- Every Worker response is sent with `Cache-Control: no-store`, so a nonce is never cached and shared.
- Pages are never prerendered. The build fails if `.output/public` contains any `.html` file, because a static page would have no nonce.
- `v-html` with content we did not write ourselves is not allowed (security rule in `.claude/rules/`).

## Consequences

- The intent of P5, that no script can run unless we wrote it, is kept. Only the wording "no inline scripts" changes, to "no inline scripts except Nuxt's own, each with a per-request nonce". P5 should be updated to match.
- Every page is server-rendered by the Worker. For the pre-launch site this is cheap.
- If Nuxt moves its inline tags elsewhere in a future version, those tags lose the nonce and the page fails to hydrate. The fix is visible straight away in the end-to-end tests, and it fails safe.
