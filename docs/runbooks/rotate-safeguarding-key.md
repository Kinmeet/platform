# Rotate the safeguarding key

- **Who may do this:** the founder, or another Cloudflare account admin under P7. Never an agent: no agent is ever asked to handle this key.
- **Access needed:** Cloudflare account admin for the Kinmeet account, and the offline copy of the current key.
- **Time needed:** about 20 minutes, plus re-encrypting the old records (see step 6).
- **Last tested:** not yet. Test it on staging, with made-up data, before relying on it.

## When to use this

- The live `SAFEGUARDING_KEY` may have been seen by anyone else, or its offline copy may have been lost or exposed.
- Someone who held the offline copy leaves their role.
- Before the M2c sunset, if the reviewers ask for it.

**What rotation does not do:** records encrypted under the old key can still be read by anyone holding the old key **and** a copy of the old ciphertext, such as D1 Time Travel (7 days on the current plan) or a backup. Rotation protects records from now on. If the old key was exposed, tell the safeguarding lead and the Security Reviewer straight away, as an incident.

## Before you start

- Find the offline copy of the current key. Its first part, before the dot, is its version, for example `v1`.
- Pick the next version number, for example `v2`. Versions only go up.
- Do it on staging first (`--env staging`), then on live.

## Steps

Keep every key value off the screen and out of shell history: never `echo` it, never type or paste it onto a command line, and never paste it into a chat, issue, email or cloud document (Nadia, #91).

1. **Keep the current key readable.** Set it as the previous key. Wrangler asks for the value at a hidden prompt, which shows nothing and is not saved in your history; paste it there from the password manager:
   `bunx wrangler secret put SAFEGUARDING_KEY_PREVIOUS --env live`
2. **Make the new key** on your own computer, with the new version number, into a shell variable so it is never shown:
   `key="$(printf 'v2.%s' "$(openssl rand -base64 32)")"`
3. **Save the offline copy first.** Put it on the clipboard (`printf '%s' "$key" | pbcopy` on macOS, `| wl-copy` or `| xclip -selection clipboard` on Linux) and save it in the password manager with MFA, then clear the clipboard. If the offline copy is on paper, write it down from the password manager, never from the terminal.
4. **Set the new key** straight from the variable, then forget it:
   `printf '%s' "$key" | bunx wrangler secret put SAFEGUARDING_KEY --env live && unset key`
5. **Check it worked** (below).
6. **Re-encrypt the old records under the new key.** The database already allows exactly this change (a record's key version may only go up). The task that does it is not built yet: ask the Tech Lead for it as a reviewed pull request, with the Security Reviewer, before you need it. Until it has run, leave `SAFEGUARDING_KEY_PREVIOUS` set, or the old records cannot be opened.
7. **Once every record is on the new version**, remove the previous key and destroy its offline copy:
   `bunx wrangler secret delete SAFEGUARDING_KEY_PREVIOUS --env live`

## Check it worked

- The acting lead opens an existing item in the safeguarding view: it opens (read with the previous key).
- Pass a made-up test message to safeguarding on **staging** and open it: it opens (written with the new key).
- If the Worker cannot use the keys, "Pass to safeguarding" answers that it is unavailable and nothing moves. That means a key is missing or malformed, or the previous key's version is not lower than the new one.

## If something goes wrong / how to undo

- **New key set wrongly:** set `SAFEGUARDING_KEY` back to the old value from the offline copy, and delete `SAFEGUARDING_KEY_PREVIOUS`. Nothing is lost, because records written under a key can always be opened with that key.
- **A record was written with a key you no longer have:** it cannot be recovered. This is why the offline copy is made before the key is set.
