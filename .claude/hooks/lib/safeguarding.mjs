// Shared checks for the safeguarding databases guard (#89).
//
// Until the M2c sunset, the interim safeguarding store
// (`kinmeet-<env>-safeguarding`, binding `SAFEGUARDING_DB`) holds disclosures
// in plain text. The team's Cloudflare connection is account-wide, so these
// checks stop agents querying, exporting or migrating it. They are a safety
// net; the founder's decision on #36 and .claude/rules/safeguarding-data.md
// are the rule.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Any safeguarding database name or binding, in any environment. */
export const SAFEGUARDING_NAME = /safeguarding[_-]?db|kinmeet-[a-z0-9-]*safeguarding/i

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Safeguarding database ids are kept out of the repository. An admin may list
 * them, comma or newline separated, in KINMEET_SAFEGUARDING_DB_IDS or in
 * ~/.kinmeet/safeguarding-db-ids on the machine the agents run on.
 */
export function safeguardingIds(env = process.env, home = homedir()) {
  const sources = [env.KINMEET_SAFEGUARDING_DB_IDS ?? '']
  const file = join(home, '.kinmeet', 'safeguarding-db-ids')
  if (existsSync(file)) sources.push(readFileSync(file, 'utf8'))
  return new Set(
    sources
      .join('\n')
      .match(UUID)
      ?.map((id) => id.toLowerCase()) ?? [],
  )
}

/**
 * The D1 ids agents may use: every `database_id` in wrangler.jsonc whose
 * database is not a safeguarding one. Placeholder ids (all zeros) are left out.
 */
export function allowedDatabaseIds(projectDir) {
  const path = join(projectDir, 'wrangler.jsonc')
  if (!existsSync(path)) return new Set()
  const config = readFileSync(path, 'utf8')
  const allowed = new Set()
  const entry = /"database_name"\s*:\s*"([^"]+)"\s*,\s*"database_id"\s*:\s*"([0-9a-f-]{36})"/gi
  for (const [, name, id] of config.matchAll(entry)) {
    if (SAFEGUARDING_NAME.test(name) || /^[0-]+$/.test(id)) continue
    allowed.add(id.toLowerCase())
  }
  return allowed
}

/** Whether `text` contains one of the safeguarding database ids. */
export function usesSafeguardingId(text, ids) {
  return (text.match(UUID) ?? []).some((id) => ids.has(id.toLowerCase()))
}

/** Why `text` touches a safeguarding database, or null if it does not. */
export function safeguardingReason(text, ids) {
  if (SAFEGUARDING_NAME.test(text)) return 'it names a safeguarding database'
  if (usesSafeguardingId(text, ids)) return 'it uses a safeguarding database id'
  return null
}

export const SAFEGUARDING_MESSAGE =
  'Agents never query, export, migrate or otherwise touch the safeguarding databases ' +
  '(kinmeet-*-safeguarding, SAFEGUARDING_DB). Only the acting safeguarding lead reads them, ' +
  'through the app. See .claude/rules/safeguarding-data.md, and ask your EM if you think you need access.'
