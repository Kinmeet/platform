# Nuxt modules audit

> **Status, 27 October 2026:** parts of this audit have moved on. The founder has chosen to adopt NuxtHub, so the NuxtHub section below is superseded by ADR-0009 (#114) once that merges. The interim safeguarding store is now an encrypted table in the main D1 (#110), so there is no separate `SAFEGUARDING_DB`. #116 plans one Worker instead of two. The rest stands as written.

Researched by Ines Duarte (Research Scout), 26 October 2026, for issue #104 and the Head of Delivery's request for a module audit.

Versions, licences and publish dates come from the npm registry (`npm view`, 26 October 2026). Behaviour claims come from each module's published package source (read with `npm pack`) or official docs, linked inline. The code reviewed is `main` at `743adde` plus the open pull requests listed against each area.

## How each module was judged

| Test                               | What it means here                                                                                                                                                |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No third-party requests at runtime | Firm rule 1. Nothing may load from another origin, except Turnstile on form pages. Build-time downloads are allowed only if the result is served from our origin. |
| Works on Workers                   | Runs on `cloudflare_module` with our hand-kept `wrangler.jsonc` and `deployConfig: false`, behind `worker/index.mjs` (ADR-0008).                                  |
| Bun-compatible                     | Installs with Bun 1.4.4 and runs on Node 24 through `bun run` (ADR-0003).                                                                                         |
| Maintained                         | A release in the last three months, and it supports Nuxt 4.6.                                                                                                     |
| Licence                            | Open source and compatible with a public, not-reused repository (MIT or Apache-2.0 here).                                                                         |
| Code it removes                    | How much of our own code goes, weighed against what it adds to review.                                                                                            |

## Summary

| Area                            | Module                                       | Version       | Recommendation                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare bindings, D1, KV, R2 | `@nuxthub/core`                              | 0.10.11       | **Reject for now.** It forces a generated Wrangler config that replaces our Worker entry (ADR-0008). Needs a decision before it can be revisited. See the [NuxtHub](#nuxthub-issue-104) section. |
| Security headers and CSP        | `nuxt-security`                              | 2.7.0         | **Reject.** Its nonce plugin stamps tags in the page body too, which undoes the main protection in ADR-0004.                                                                                     |
| Turnstile                       | `@nuxtjs/turnstile`                          | 1.1.3         | **Reject.** Needs `@nuxt/scripts`, adds a public validate route, and does not check hostname or action.                                                                                          |
| i18n                            | `@nuxtjs/i18n`                               | 10.6.0        | **Keep** (already adopted).                                                                                                                                                                      |
| Fonts                           | `@nuxt/fonts`                                | 1.2.0         | **Adopt later.** It can use our Fontsource packages offline and add fallback metrics, but removes little code today.                                                                             |
| Forms and validation            | (Zod, ADR-0005)                              |               | **No module.** `nuxt-zod-i18n` 1.12.1 is stale and solves a problem we don't have.                                                                                                               |
| Admin and Access check          | `jose` (library, not a module)               | 6.2.13        | **Adopt.** Cloudflare's own docs use it for Access tokens, and it replaces most of the hand-written verifier in #51. `ctx.access` can't be used, because we have static assets.                  |
| Passkeys and sessions (M2a)     | `nuxt-auth-utils`                            | 0.5.32        | **Adopt later**, at M2a.                                                                                                                                                                         |
| Email templates                 | `nuxt-email-renderer`                        | 2.11.2        | **Reject.** Our templates are fixed text with no links, which is a security choice (ADR-0006).                                                                                                   |
| Scheduled deletion job          | (Nitro tasks)                                |               | **No module.** Already uses the built-in Nitro scheduled tasks.                                                                                                                                  |
| Testing                         | `@nuxt/test-utils`                           | 4.3.4         | **Adopt.** Already being added in #51, so no new issue.                                                                                                                                          |
| Linting                         | `@nuxt/eslint`                               | 1.17.0        | **Keep** (already adopted).                                                                                                                                                                      |
| Accessibility                   | `@nuxt/a11y`                                 | 1.0.0-alpha.1 | **Adopt later.** Alpha, and DevTools-only. Our Playwright axe scan stays the gate.                                                                                                               |
| SEO and robots                  | `@nuxtjs/robots`                             | 7.0.2         | **Adopt**, with `botDetection: false`. Staging and Previews are indexable today.                                                                                                                 |
| Sitemap and SEO bundle          | `@nuxtjs/sitemap` 9.1.0, `@nuxtjs/seo` 6.0.1 |               | **Adopt later.** Not worth it for a handful of pages.                                                                                                                                            |
| Third-party scripts             | `@nuxt/scripts`                              | 1.3.12        | **Reject.** Its purpose is loading third-party scripts.                                                                                                                                          |
| Images and icons                | `@nuxt/image` 2.2.0, `@nuxt/icon` 2.6.1      |               | **Reject for now.** No images to optimise yet. Icon can call the Iconify API at runtime.                                                                                                         |
| CSRF                            | `nuxt-csurf`                                 | 1.6.6         | **Reject.** Our Origin and content-type checks already cover it.                                                                                                                                 |
| Performance hints               | `@nuxt/hints`                                | 1.1.5         | **Reject.** DevTools-only, and we turn DevTools off.                                                                                                                                             |

That gives two new adopt issues: #105 (Access check with `jose`) and #106 (robots). `@nuxt/test-utils` is already in #51.

## NuxtHub (issue #104)

The founder asked whether most of our Cloudflare work could be done with the latest NuxtHub. I checked `@nuxthub/core` 0.10.11 (Apache-2.0, published 23 October 2026), its [deploy docs](https://hub.nuxt.com/docs/getting-started/deploy) and its published source, against each item in #104.

### What it would give us

- `hub:db`: a Drizzle ORM client on the `DB` binding, with schema files in `server/db/`, generated migrations, and typed queries.
- `hub:kv` and `hub:cache` on KV, and `hub:blob` on R2 (with a `jurisdiction` option for the binding).
- One place in `nuxt.config.ts` to declare bindings. It runs on our own Cloudflare account. The NuxtHub admin and CLI are deprecated, and the admin was sunset on 31 December 2025, so there is no NuxtHub service in the path.

### Checklist from #104

| Item                                                | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1 access and `scripts/d1-migrate.sh` vs `hub:db`   | `hub:db` replaces our hand-written SQL in `server/utils/db/` with Drizzle. It sets `migrations_dir: db/migrations/sqlite/` and `migrations_table: _hub_migrations` on the `DB` binding. Migrations still need a separate step, because "D1 migrations aren't applied automatically by `wrangler deploy` or Workers Builds" (deploy docs). An `applyMigrationsDuringBuild` option exists, but on D1 it goes through the HTTP API with an API token in the build. Our two migrations would need porting, and the `_hub_migrations` table would start fresh.                                                                                                                                                                                                                                        |
| R2 and KV vs `hub:blob` and `hub:kv`                | Usable, but no code uses KV or R2 yet, so nothing is removed today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `wrangler.jsonc` environments and the deletion cron | **Blocker.** NuxtHub always sets `nitro.cloudflare.deployConfig = true` (`setupCloudflare` in `dist/module.mjs`), overriding our `false`. Nitro then writes `.output/server/wrangler.json` with `main` forced to Nitro's own `index.mjs` (`writeWranglerConfig` in Nitro 2.13.5). It only logs a warning that our `main` "is overridden and will be ignored". So `worker/index.mjs`, which refuses oversized bodies before Nitro reads them (ADR-0008, #60), would silently drop out of the deployed Worker. NuxtHub then flattens one environment into the top level at build time, chosen by `CLOUDFLARE_ENV`, so staging, live and Previews would each need their own build setting. Crons, rate limiters, `secrets.required` and observability would still have to live in `wrangler.jsonc`. |
| Self-hosted, no third-party at runtime              | Yes. Bindings only, no NuxtHub service.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Workers Builds, Previews and our two Workers        | Possible, but ADR-0001 would need reworking around `CLOUDFLARE_ENV` and the generated config. Preview builds run `wrangler preview --env staging`, which would have to match the generated file.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| EU jurisdiction for D1 and R2                       | NuxtHub does not create resources, it binds the ids we give it, so our existing EU resources keep their jurisdiction. R2 bindings take `jurisdiction`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Migrations inside Builds; Bun                       | Drizzle Kit runs on Node through `bun run`. Applying migrations in Builds needs the D1 HTTP driver and a Cloudflare API token as a build secret. That is a new credential to scope (P5).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Other gaps                                          | `hub:db` binds only `DB`. The separate `SAFEGUARDING_DB` (CLAUDE.md rule 5) would stay hand-wired. In development, NuxtHub uses a local libSQL file by default rather than workerd's D1 (`resolveDatabaseConfig`), so dev would differ from our Workers-runtime tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Recommendation

**Do not migrate now.** The forced `deployConfig` is the deciding problem: it removes our request-size protection without failing the build. Working around it (switching `deployConfig` back off in a later hook and keeping `wrangler.jsonc` by hand) leaves only the runtime helpers, in a setup NuxtHub does not support.

If the founder wants Drizzle's typed queries, the smaller step is **Drizzle ORM on its own** (`drizzle-orm` 0.45.4) against our existing `DB` binding and hand-kept `wrangler.jsonc`. That gets most of what `hub:db` offers without changing deploys. I'd treat it as a separate decision for the Services squad, not part of this audit's adopt list.

Revisit NuxtHub if either of these happens: NuxtHub lets `deployConfig` stay off, or Nitro gains a supported way to keep a custom `main` with a generated config. **This needs the founder's call**, because it goes against what #104 hoped for.

## Area by area

### Security headers and CSP: `nuxt-security` (reject)

Ours: `server/utils/security-headers.ts`, `server/middleware/security-headers.ts`, `server/plugins/security-nonce.ts` and `server/utils/html-nonce.ts`, about 160 lines including comments. There is also a generated `_headers` file for static assets.

`nuxt-security` 2.7.0 (MIT, 24 October 2026) covers the same headers and has a per-request nonce. But its nonce plugin (`dist/runtime/nitro/plugins/40-cspSsrNonce.js`) adds the nonce to every `<script>`, `<style>` and `<link>` in `body`, `bodyAppend`, `bodyPrepend` and `head`. ADR-0004 deliberately stamps only `head` and `bodyAppend`, so a tag injected into page content by a bug does not get a valid nonce. A unit test checks this. Adopting the module would remove that protection. Its rate limiter keeps counts in Nitro storage, which on Workers is per isolate, so it is weaker than our rate limiting bindings. Its CSRF option pulls in `nuxt-csurf`. It also wouldn't produce our `_headers` file for static assets.

### Turnstile: `@nuxtjs/turnstile` (reject)

Ours: `app/components/TurnstileCheck.vue` and `app/utils/turnstile.ts` (execute mode, interaction-only, compact below 300 px, single-use tokens), plus `server/utils/forms/turnstile.ts`.

`@nuxtjs/turnstile` 1.1.3 (MIT, 16 October 2026):

- It needs `@nuxt/scripts` as a peer dependency, which we reject.
- It registers a server route, `runtime/server/validate.post.js`.
- Its `verifyTurnstileToken` returns the raw siteverify response with no timeout. It does not check `hostname` or `action`, or fail closed.

We would keep almost all of our server code and lose control of how the widget runs.

### i18n: `@nuxtjs/i18n` (keep)

Already in use (10.6.0, latest). `no_prefix` with browser detection off matches P9. Nothing to change.

### Fonts: `@nuxt/fonts` (adopt later)

`@nuxt/fonts` 1.2.0 (MIT, 25 October 2026) has an `npm` provider that "resolves fonts from npm packages installed in your project's `node_modules`" and by default reads the stylesheet "from disk (`remote: false`) rather than from a CDN", serving the files from our own origin ([providers](https://fonts.nuxt.com/get-started/providers)). "Setting a top-level `provider` disables every other provider", so `provider: 'npm'` keeps the build offline. It also generates fallback `@font-face` rules from font metrics (it uses `fontaine`), which reduces layout shift while the fonts load.

It would replace the three `@import` lines in `app/assets/css/main.css`. The build check for the OFL files stays (ADR-0007). This is worth doing if layout shift shows up in the accessibility or performance review. It removes too little code to prioritise now.

### Forms and validation (no module)

Zod 4 with our own error codes (ADR-0005) is the right fit. `nuxt-zod-i18n` 1.12.1 was last published on 31 July 2025 and translates Zod's own messages, which we never show.

### Admin page and Cloudflare Access: `jose` (adopt)

#51 adds `server/utils/admin/access.ts`, 132 lines of hand-written JWT and JWKS verification with Web Crypto.

- **`ctx.access` is not an option for us.** Cloudflare's [Access for Workers docs](https://developers.cloudflare.com/workers/configuration/cloudflare-access/) say: "Workers with Static Assets execute behind an internal router Worker. Access still protects the application and its assets. However, the router does not pass `ctx.access` to the user Worker." We use static assets, so the Worker has to verify the `Cf-Access-Jwt-Assertion` token itself.
- Cloudflare's own example for that verification uses `jose`'s `createRemoteJWKSet` and `jwtVerify` with `issuer` and `audience` ([changelog, one-click Access for Workers](https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/)). `jose` 6.2.13 is MIT, published 20 October 2026, and has no dependencies on Workers.
- That would remove the base64url decoding, key import, signature check and most of the key-cache code, so `access.ts` drops to the configuration and fail-closed checks. Hand-rolled JWT verification is easy to get subtly wrong, so a widely reviewed library is the safer choice.

Owner: Services (Ade, for #51), reviewed by Nadia.

### Passkeys and sessions: `nuxt-auth-utils` (adopt later, M2a)

`nuxt-auth-utils` 0.5.32 (MIT, 16 October 2026) gives sealed-cookie sessions and WebAuthn registration and authentication (`dist/runtime/server/lib/webauthn/`). That matches P5's passkey sign-in. It runs on Web Crypto, so it suits Workers. One concern for later: it peers `@simplewebauthn/server` `^11`, while the current release is 14.0.3. Sami should re-check at M2a.

### Email templates (reject a module)

`nuxt-email-renderer` 2.11.2 renders Vue components to email HTML. ADR-0006 keeps templates as fixed text from `i18n/locales/`, with no links, images or remote styles, so that a form can't be used to send chosen words. `server/email/templates.ts` is under 100 lines. A component renderer adds surface area without removing a risk.

### Scheduled deletion job (no module)

`server/tasks/retention/delete-expired.ts` already uses Nitro's built-in `scheduledTasks` with a matching cron in `wrangler.jsonc`. That is the supported route, so nothing to add.

### Testing: `@nuxt/test-utils` (adopt, already in #51)

#51 adds `@nuxt/test-utils` 4.3.4 with `@vue/test-utils` and `happy-dom` for `tests/nuxt/`. That is right: `cloudflareTest()` does not support custom Vitest environments, so Nuxt component tests need their own Vitest project, separate from the workerd tests. No new issue.

### Accessibility: `@nuxt/a11y` (adopt later)

`@nuxt/a11y` 1.0.0-alpha.1 gives "real-time accessibility feedback during development" in DevTools ([modules directory](https://nuxt.com/modules)). It is alpha, and we turn DevTools off. The Playwright axe scan stays the gate. Revisit when it reaches a stable release.

### Robots: `@nuxtjs/robots` (adopt)

Today there is no `robots.txt` and no `X-Robots-Tag` on staging or live pages. Only Preview URLs send `noindex` (docs/environments.md). So `kinmeet-staging.kinmeet.workers.dev`, with its made-up data, can be indexed.

`@nuxtjs/robots` 7.0.2 (MIT, 13 October 2026) serves `robots.txt`, sends `X-Robots-Tag` and adds robots meta tags. It decides indexing per environment through site config (`indexable`). Two settings matter:

- `botDetection` defaults to `true` (`dist/module.mjs`). Turn it off. Its client composable can load `@fingerprintjs/botd` and keep results in `localStorage`, which is not something we want near visitors.
- Debug routes (`/__robots__/debug.json`) are registered only when `debug` is on or in dev, so the default is fine.

The no-third-party and CSP tests should be re-run with it on. Whether live should be indexed before launch is a product question for the Head of Delivery. The module makes either choice one setting.

### Sitemap and the SEO bundle (adopt later)

`@nuxtjs/sitemap` 9.1.0 and `@nuxtjs/seo` 6.0.1 are maintained, but the pre-launch site has a handful of pages. Revisit when there are local group pages.

### Third-party scripts: `@nuxt/scripts` (reject)

Its purpose is loading third-party scripts, which firm rule 1 forbids. The one allowed case, Turnstile, is handled by our component.

### Images and icons (reject for now)

`@nuxt/image` 2.2.0's Cloudflare provider needs image transformations on a zone, and we only have `workers.dev`. We have no photos yet. `@nuxt/icon` 2.6.1 can fetch icons from the Iconify API at runtime unless they are bundled. We have no icon set; our graphics are inline SVG components, so there is nothing to gain.

### CSRF: `nuxt-csurf` (reject)

The forms pipeline already checks `Origin` and content type before anything else (ADR-0005, `server/utils/forms/request.ts`), and there are no cookie-based sessions yet. Revisit with `nuxt-auth-utils` at M2a.

### Performance hints: `@nuxt/hints` (reject)

DevTools-only. We set `devtools: { enabled: false }`.

## Sources

- npm registry, `npm view <package> version license time.modified repository.url` and `npm pack`, 26 October 2026: `@nuxthub/core`, `nuxt-security`, `@nuxtjs/turnstile`, `@nuxtjs/i18n`, `@nuxt/fonts`, `fontless`, `unifont`, `@nuxt/test-utils`, `@nuxt/scripts`, `nuxt-auth-utils`, `@nuxt/eslint`, `@nuxtjs/robots`, `@nuxtjs/sitemap`, `@nuxtjs/seo`, `@nuxt/a11y`, `@nuxt/hints`, `@nuxt/image`, `@nuxt/icon`, `nuxt-csurf`, `nuxt-email-renderer`, `nuxt-zod-i18n`, `jose`, `drizzle-orm`, `@simplewebauthn/server`
- Nitro 2.13.5 Cloudflare preset source, `dist/presets/cloudflare/utils.mjs` (`writeWranglerConfig`)
- Nuxt modules directory: https://nuxt.com/modules
- NuxtHub deploy docs: https://hub.nuxt.com/docs/getting-started/deploy
- Nuxt Fonts providers: https://fonts.nuxt.com/get-started/providers
- Cloudflare Access for Workers and `ctx.access`: https://developers.cloudflare.com/workers/configuration/cloudflare-access/
- Validating Access tokens with `jose`: https://developers.cloudflare.com/changelog/post/2025-10-03-one-click-access-for-workers/
