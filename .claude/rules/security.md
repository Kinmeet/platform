# Security

Source document: P5 Security design. Assume the code is public, the server could one day be breached, and an insider could misuse access.

- **Secrets** live only as Worker secrets per environment (`wrangler secret put`) or GitHub Actions secrets. Never in the repository, `wrangler` config, issues, PRs or logs. Local values go in `.dev.vars`, which is ignored and never committed. Hooks block writing, reading or committing `.env*`, `.envrc`, `.dev.vars*` and key files, and scan commits and pushes for likely secrets. The hooks are a safety net, not the control: GitHub secret scanning, push protection, a CI secret scan, branch protection and a protected `live` environment sit behind them. Never work around a hook; if one blocks you wrongly, tell your EM.
- **API tokens** are scoped to one job each and to the Kinmeet account only.
- **Headers on every response:** strict Content-Security-Policy (`default-src 'self'`, `frame-ancestors 'none'`, no inline scripts; Turnstile's origin only on routes marked as form pages), HSTS with preload, `Referrer-Policy: no-referrer`, a Permissions-Policy that turns off camera, microphone and location, `X-Content-Type-Options: nosniff`. Do not loosen the CSP to make something work; fix the thing.
- **No `v-html` (or `innerHTML`) with anything we did not write ourselves.** The CSP adds nonces to Nuxt's own inline tags, so injected markup must never reach the page.
- **Nothing loaded from a CDN.** Fonts, scripts and styles are served from our own origin.
- **Forms:** verify Turnstile tokens on the server, rate limit per form, validate all input strictly on the server (never trust the client), store no IP addresses.
- **Files:** uploads go to R2 under random names, are size and type checked, and are served only through the app after a permission check. No public buckets.
- **Sessions:** Secure, HttpOnly, SameSite=Lax cookies. Sensitive roles get 12-hour sessions; sensitive actions ask for the passkey again.
- **Cryptography:** standard primitives only (AES-256-GCM, X25519, Argon2id) from Web Crypto or one audited library served from our origin. No home-made algorithms. Encrypted areas must stay unreadable by the server and the developer.
- **Dependencies:** few, pinned in the lockfile. Adding one needs a reason in the PR description.
- **SQL:** always use bound parameters (`prepare(...).bind(...)`). Never build SQL from strings.
- Any change to sign-in, sessions, roles, headers, crypto, uploads or secrets needs the Security Reviewer.
