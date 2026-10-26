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
 * The D1 databases agents may use: every `database_name` and `database_id` in
 * wrangler.jsonc that is not a safeguarding one, plus the `DB` binding.
 * Placeholder ids (all zeros) are left out. Expects `database_name` directly
 * before `database_id` in each entry, as in wrangler.jsonc today; a test reads
 * the real file so a layout change is caught.
 */
export function allowedDatabases(projectDir) {
  const ids = new Set()
  const names = new Set(['db'])
  const path = join(projectDir, 'wrangler.jsonc')
  if (!existsSync(path)) return { ids, names }
  const config = readFileSync(path, 'utf8')
  const entry = /"database_name"\s*:\s*"([^"]+)"\s*,\s*"database_id"\s*:\s*"([0-9a-f-]{36})"/gi
  for (const [, name, id] of config.matchAll(entry)) {
    if (SAFEGUARDING_NAME.test(name)) continue
    names.add(name.toLowerCase())
    if (!/^[0-]+$/.test(id)) ids.add(id.toLowerCase())
  }
  return { ids, names }
}

/** The ids from `allowedDatabases`, for the D1 tools that take a bare id. */
export function allowedDatabaseIds(projectDir) {
  return allowedDatabases(projectDir).ids
}

/**
 * Every D1 database path segment in `text` (`/d1/database/<segment>`) that is
 * not a literal allowed id. A segment built at run time (`${d.uuid}`,
 * `' + id`, a shell variable) is never allowed, because the hook cannot know
 * what it will be. Listing `/d1/database` with no segment is allowed.
 */
export function unknownD1Paths(text, allowedIds) {
  const unknown = []
  for (const [, segment] of text.matchAll(/\/d1\/database\/([^/?#\s]*)/gi)) {
    const id = segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0]
    const literal = id && !/[$`{(+]/.test(segment.slice(id.length))
    if (!literal || !allowedIds.has(id.toLowerCase()))
      unknown.push(segment || '(built at run time)')
  }
  return unknown
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
