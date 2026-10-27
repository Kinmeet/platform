// Shared checks for the interim safeguarding store guard (#89, revised in
// #109 for the encrypted store decided on #95).
//
// Until the M2c sunset, handed-over disclosures are stored encrypted in the
// `safeguarding_items` table of the main D1. The key is the Worker secret
// `SAFEGUARDING_KEY` (with `SAFEGUARDING_KEY_PREVIOUS` during a rotation).
// These checks stop agents touching that table on a real database and
// handling the key. They are a safety net: the founder's decisions on #36 and
// #95 and .claude/rules/safeguarding-data.md are the rule, and read-only
// Cloudflare access for agents (go-live condition 6) is the control.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The encrypted store's table. */
export const SAFEGUARDING_TABLE = /safeguarding_items/i

/** The store's key secrets, current and previous. */
export const SAFEGUARDING_KEY = /safeguarding_key/i

/** The live Worker, by its dashboard name or its wrangler name. */
export const LIVE_WORKER = /\b(platform|kinmeet)-live\b/i

/**
 * Every Worker script path segment in `text` (`/workers/scripts/<segment>`)
 * that is not the literal staging Worker, `platform-staging`, which also
 * serves the Previews. A segment built at run time (`${w}`, `' + w`, a shell
 * variable) is never allowed, as in `unknownD1Paths`.
 */
export function unknownScriptPaths(text) {
  const unknown = []
  for (const [, segment] of text.matchAll(/\/workers\/scripts\/([^/?#\s]*)/gi)) {
    const literal =
      /^platform-staging(?![\w-])/i.test(segment) && !/[$`{(+]/.test(segment.slice(16))
    if (!literal) unknown.push(segment || '(built at run time)')
  }
  return unknown
}

/**
 * The D1 databases agents may use: every `database_name` and `database_id` in
 * wrangler.jsonc, plus the `DB` binding. Placeholder ids (all zeros) are left
 * out. Expects `database_name` directly before `database_id` in each entry, as
 * in wrangler.jsonc today; a test reads the real file so a layout change is
 * caught.
 */
export function allowedDatabases(projectDir) {
  const ids = new Set()
  const names = new Set(['db'])
  const path = join(projectDir, 'wrangler.jsonc')
  if (!existsSync(path)) return { ids, names }
  const config = readFileSync(path, 'utf8')
  const entry = /"database_name"\s*:\s*"([^"]+)"\s*,\s*"database_id"\s*:\s*"([0-9a-f-]{36})"/gi
  for (const [, name, id] of config.matchAll(entry)) {
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

/**
 * Why a Cloudflare API call (MCP tool input, or a curl to the API) is refused,
 * or null. Every such call reaches a real account, so naming the table is
 * enough. The key may be handled only on the staging Worker, by code that
 * generates it in the Cloudflare runtime: every Worker script path must be
 * the literal staging Worker, and there must be at least one. A live Worker,
 * or a Worker the hook cannot see, is refused.
 */
export function cloudflareCallReason(text) {
  if (SAFEGUARDING_TABLE.test(text)) return 'it touches the safeguarding_items table'
  if (SAFEGUARDING_KEY.test(text)) {
    const scripts = [...text.matchAll(/\/workers\/scripts\//gi)].length
    if (LIVE_WORKER.test(text) || scripts === 0 || unknownScriptPaths(text).length > 0)
      return 'it handles the safeguarding key outside the staging Worker'
  }
  return null
}

export const SAFEGUARDING_MESSAGE =
  'Agents never query, change or export the safeguarding_items table on a real database, never see a ' +
  'safeguarding key, and never read, set or rotate the live key. Only the acting safeguarding lead reads ' +
  'records, through the audited safeguarding view. See .claude/rules/safeguarding-data.md, and ask your ' +
  'EM if you think you need access.'
