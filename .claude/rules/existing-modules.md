# Check for an existing module first

Source: the Head of Delivery, following the founder's feedback that we were hand-building things a maintained Nuxt module already does.

- **Before building any feature**, look for something that already does it:
  - [nuxt.com/modules](https://nuxt.com/modules);
  - the Nuxt and Nitro docs, since many needs are covered by a built-in feature or config option;
  - current, maintained packages for the same job.
- **Adopt a candidate when it fits.** Less of our own code means less to review, test and maintain.
- **A candidate must still pass our rules.** Reject it if it:
  - makes third-party requests or loads anything from a CDN;
  - adds tracking or inline scripts;
  - does not run on Cloudflare Workers;
  - is unmaintained (no release or commit activity in the last year, or open security issues);
  - pulls in a large dependency tree for a small need;
  - conflicts with a made decision (F, SG, S, P or an ADR).
- **Say what you found in the PR description**, under "Existing modules checked":
  - the module or built-in feature adopted; or
  - each candidate considered and why it was rejected; or
  - "None found", with where you looked.
- **A PR that builds a feature without that section is not done.**
- **Adding a module is adding a dependency.** It is pinned in `bun.lock`, and the PR description gives the reason, as `security.md` requires. A non-obvious choice between candidates gets an ADR.
- If an existing feature could be replaced by a module you find, open an issue rather than widening your PR.
