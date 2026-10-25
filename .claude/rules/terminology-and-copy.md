# Terminology and copy

Applies to every piece of user-facing text: pages, emails, error messages, alt text, page titles, and the strings in `i18n/locales/`.

- **"all-ages"**, never SFW or NSFW.
- **"local group"** or **"group"**, never chapter.
- **"meet"**, never moot.
- **Never name or compare other communities** or organisations. Describe what Kinmeet does, not what others do. Signposting to emergency services (999) and support helplines on safeguarding and help pages is fine.
- **People in roles** appear by role title and community name only.
- **British English** everywhere, including code comments, commit messages and docs: organise, colour, licence (noun), programme, centre, behaviour.
- **Plain English:** short sentences, everyday words, active voice. Say what happens next. Avoid jargon and acronyms on public pages, or explain them on first use.
- **Translation-ready:** no hard-coded copy in components. Every string goes through i18n keys, with whole sentences per key (never glue fragments together).
- **Dates and times** in UK format (25 October 2026, 14:30).
- Use the `kinmeet-copy-check` skill on any change that adds or edits user-facing text.
