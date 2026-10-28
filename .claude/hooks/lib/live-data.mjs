// Checks that keep live personal data (say hello messages, applications) on
// Cloudflare (#111, under #47). Agents may read live D1 metadata, but never
// copy rows to an agent machine with a remote `execute` or `export`, and never
// change a live database: live migrations run only from the live Workers
// Build. Break-glass access to live data follows P7. These checks are a safety
// net: `.claude/rules/privacy.md` is the rule.
import { allowedDatabases, liveDatabases } from './safeguarding.mjs'

/**
 * The only `wrangler d1` commands agents may run on a live database (Rowan,
 * 27 October 2026). Both return metadata, never rows. Anything else on a live
 * database is refused unless it is explicitly `--local`.
 */
export const LIVE_D1_COMMANDS = new Set(['migrations list', 'info'])

// `wrangler d1` subcommands that take a second word.
const TWO_WORD = new Set(['migrations', 'time-travel', 'insights'])

const LIVE_ENV = /(?:--env|-e)(?:=|\s+)['"]?live\b/i
const STAGING_ENV = /(?:--env|-e)(?:=|\s+)['"]?staging\b/i
// Wrangler also picks the environment from CLOUDFLARE_ENV, and after a build
// it reads the generated config, which ignores `--env` (ADR-0009). With one
// Worker every build is `live` (ADR-0001).
export const LIVE_CLOUDFLARE_ENV = /\bCLOUDFLARE_ENV=['"]?live\b/i
// `--env` is honoured only when the hand-kept file is named, because the
// generated config ignores it (ADR-0009, condition 5).
export const HAND_KEPT_CONFIG = /--config(?:=|\s+)['"]?(?:\.\/)?wrangler\.jsonc['"]?(?=\s|$)/

// `wrangler d1` subcommands that name no existing database.
const NO_DATABASE = new Set(['list', 'create'])

/** Why a `wrangler d1` command or migration script would reach live data, or null. */
export function liveD1CommandReason(command, projectDir) {
  if (/\bd1-migrate\.sh['"]?\s+['"]?live\b/.test(command))
    return 'live migrations run only from the live Workers Build'
  const { ids, names } = liveDatabases(projectDir)
  const known = allowedDatabases(projectDir)
  const isStaging = (w) =>
    (known.names.has(w) && w !== 'db' && !names.has(w)) || (known.ids.has(w) && !ids.has(w))
  const liveByEnvironment = LIVE_CLOUDFLARE_ENV.test(command)
  for (const segment of command.split(/;|&&|\|\||\||\n/)) {
    const words = (segment.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((w) =>
      w.replace(/^['"]|['"]$/g, ''),
    )
    const at = words.findIndex(
      (w, i) => w === 'd1' && words.slice(Math.max(0, i - 3), i).some((p) => /wrangler$/.test(p)),
    )
    if (at === -1) continue
    const first = words[at + 1] ?? ''
    const subcommand = TWO_WORD.has(first) ? `${first} ${words[at + 2] ?? ''}` : first
    const targets = words.slice(at + 1).map((w) => w.toLowerCase())
    // Fails closed (Security Reviewer, #112): a database command counts as
    // live unless it names staging explicitly, by a staging database's name
    // or id, or by `--env staging` with `--config wrangler.jsonc`.
    const explicitStaging =
      (STAGING_ENV.test(segment) && HAND_KEPT_CONFIG.test(segment)) || targets.some(isStaging)
    const live =
      liveByEnvironment ||
      LIVE_ENV.test(segment) ||
      targets.some((w) => names.has(w) || ids.has(w)) ||
      (!explicitStaging && !NO_DATABASE.has(subcommand))
    if (!live || LIVE_D1_COMMANDS.has(subcommand) || /--local\b/.test(segment)) continue
    return `wrangler d1 ${subcommand} on a live database could copy or change live personal data`
  }
  return null
}

// A request that sends or changes something: an explicit method other than
// GET, a helper such as `cf.post(...)`, or curl data or form flags.
const NOT_A_READ = [
  /\bmethod\s*:\s*['"`](POST|PUT|PATCH|DELETE)\b/i,
  /\.(post|put|patch|delete)\s*\(/i,
  /(?:\s-X|--request)(?:=|\s*)['"]?(POST|PUT|PATCH|DELETE)\b/i,
  /\s(?:-d|--data(?:-[\w-]+)?|-F|--form)(?:=|\s)/,
]

/**
 * Why a D1 API call (curl, or Cloudflare MCP tool code) would reach live data,
 * or null. The only call allowed on a live database id is `GET` of the
 * database's own details, `/d1/database/<live id>`. Its `query`, `raw`,
 * `export`, `import` and `time_travel` paths, or any write, are refused.
 */
export function liveD1ApiReason(text, projectDir) {
  const { ids } = liveDatabases(projectDir)
  for (const [, id, rest] of text.matchAll(/\/d1\/database\/([0-9a-f-]{36})([^\s'"`?#)]*)/gi)) {
    if (!ids.has(id.toLowerCase())) continue
    if (rest !== '' && rest !== '/')
      return `the D1 API path ${rest} on a live database could copy or change live personal data`
    if (NOT_A_READ.some((pattern) => pattern.test(text)))
      return 'only a GET of the details of a live database is allowed through the D1 API'
  }
  return null
}

/** Why a Workers Bindings D1 tool call would reach live data, or null. */
export function liveD1ToolReason(toolName, toolInput, projectDir) {
  if (!/d1_database/i.test(toolName) || !toolInput.database_id) return null
  if (/d1_database_get$/i.test(toolName)) return null
  const { ids } = liveDatabases(projectDir)
  return ids.has(String(toolInput.database_id).toLowerCase())
    ? `${toolName} on a live database could copy or change live personal data`
    : null
}

export const LIVE_DATA_MESSAGE =
  'Live personal data never goes to an agent machine, and agents never change a live database. On a ' +
  'live database agents may run only `wrangler d1 migrations list` and `wrangler d1 info`, or read its ' +
  'details with a GET through the D1 API. Live migrations run only from the live Workers Build, and ' +
  'break-glass access follows P7. See .claude/rules/privacy.md, and ask your EM if you think you need more.'
