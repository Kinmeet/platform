# ADR-0007: Self-hosted fonts from Fontsource

- **Status:** Accepted
- **Date:** 26 October 2026
- **Author:** Mei Lin Tan (Frontend Engineer)
- **Reviewers:** Theo Marsh (Tech Lead), Ines Duarte (Research Scout), Robin Achterberg (Accessibility Reviewer)
- **Related:** issues #3 and #10; firm rule 1; P11 Accessibility statement; pre-launch design (patch language)

## Context

The patch language uses two typefaces: Fredoka 600 for display text and Atkinson Hyperlegible Next 400 and 700 for body text, chosen because it was designed for readers with low vision. The design loads both from Google Fonts. Firm rule 1 forbids third-party requests on any page, so the fonts must be served from our own origin. Sprint 0 (#3) added the Fontsource packages; this records why, and what we checked.

The site will be translated into Welsh later (P1 Phase 4), so the fonts need ŵ and ŷ, or a plan for when they are missing.

## Decision

Serve both fonts from our own origin through the Fontsource npm packages, pinned to exact versions: `@fontsource-variable/fredoka` (weight axis only, `wght.css`) and `@fontsource/atkinson-hyperlegible-next` (`400.css` and `700.css` only). Vite bundles the font files with the app.

- **Licence:** both are under the SIL Open Font Licence 1.1, which allows bundling and serving the fonts with our site. The licence text ships in each package's `LICENSE` file.
- **Subsets:** Fontsource splits each font by `unicode-range`, so a browser only downloads the Latin file (Fredoka about 32 KB, Atkinson about 12 KB and 16 KB) unless a page uses other characters. We do not subset further by hand.
- **Welsh:** Atkinson Hyperlegible Next's Latin Extended files include ŵ, ŷ, Ŵ and Ŷ. **Fredoka does not have them at all.** The display font stack is `'Fredoka Variable', 'Atkinson Hyperlegible Next', system-ui`, so in a Welsh heading those letters fall back to Atkinson rather than to a system font.
- **Variable Fredoka:** one variable file covers the 500, 600 and 700 weights the design uses, and is smaller than three static files.

## Options considered

| Option                                                           | For                                                                  | Against                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Fontsource packages, bundled by Vite (chosen)                    | Pinned versions, updated like any other dependency, licence included | Package also ships unused faces (Hebrew, italics); they are never fetched |
| Download the files into `public/fonts/` by hand                  | No dependency                                                        | Manual updates; easy to lose the licence file; no `unicode-range` split   |
| Google Fonts                                                     | Easiest                                                              | Third-party request; breaks firm rule 1                                   |
| System fonts only                                                | Zero download                                                        | Loses the patch language and Atkinson's legibility for low-vision readers |
| Replace Fredoka with a display font that has full Welsh coverage | No mixed glyphs in Welsh headings                                    | Changes the agreed design; not needed until Welsh launches                |

## Consequences

- No font request leaves our origin, and the no-third-party test covers this.
- First visit downloads about 60 KB of fonts for English pages.
- When Welsh pages arrive, ŵ and ŷ in display headings will be drawn in Atkinson. The Web squad should check how that looks before the Welsh launch and decide whether to keep it, ask for Fredoka to be extended (it is open source), or change the display font. That is a design decision, not one to make silently in code.
- Upgrading a font package means checking its `LICENSE` is still the OFL.

## Sources

- Fontsource Fredoka and Atkinson Hyperlegible Next packages, version 5.3.0: `LICENSE`, `unicode.json` and the font files in `node_modules`, inspected with fontTools on 26 October 2026.
- SIL Open Font Licence 1.1: https://openfontlicense.org/ (checked 26 October 2026). Ines to confirm against the upstream font repositories.
