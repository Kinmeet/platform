---
name: kinmeet-copy-check
description: Check user-facing text for Kinmeet terminology, British English, plain English and translation readiness. Use on any change to pages, components, emails, error messages, alt text or i18n locale files.
---

# Kinmeet copy check

## 1. Find the text

Collect every user-facing string the change adds or edits: `i18n/locales/` entries, email templates, page titles and meta descriptions, alt text, ARIA labels, error and empty-state messages, and any hard-coded text in `app/` (which itself is a finding).

## 2. Terminology (must fix)

| Use | Never |
| --- | --- |
| all-ages | SFW, NSFW, family-friendly as a substitute |
| local group, group | chapter |
| meet | moot |
| role title and community name for people in roles | legal names, faces, addresses |

Never name or compare other communities or organisations.

Run `bun run check:copy` (CI runs it on the translation files). For text outside `i18n/locales/`, search as well:

```sh
grep -rniE '\b(n?sfw|chapters?|moots?)\b' app server content 2>/dev/null
```

## 3. British English (must fix)

organise, recognise, colour, behaviour, centre, licence (noun) and license (verb), programme (not computer program), travelling, cancelled, enrol, practise (verb). Dates as 25 October 2026; times as 14:30.

## 4. Plain English (should fix)

- Short sentences (aim under 20 words), everyday words, active voice.
- Say what happens next and what the person needs to do.
- Explain any acronym on first use, or avoid it.
- Warm and welcoming, never alarming. Safety wording is calm and factual.
- Links describe where they go ("read the privacy notice", not "click here").

## 5. Translation readiness (must fix)

- No hard-coded strings in components; everything through i18n keys.
- Whole sentences per key; never build sentences by joining fragments.
- Use interpolation and plural rules for numbers and names.
- Keys are descriptive (`hello.form.submit`), not the English text.

## 6. Report

List each finding with file, line, the current text, and the suggested text, grouped as Must fix, Should fix and Nit. Sign with your persona name.
