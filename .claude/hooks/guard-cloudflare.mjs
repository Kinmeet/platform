// PreToolUse hook for the Cloudflare MCP tools (the Cloudflare API `execute`
// tool and the older Workers Bindings D1 tools). Blocks any call that touches
// the encrypted safeguarding table or handles the safeguarding key outside the
// staging Worker (#89, #109), any Time Travel restore of a live database,
// any D1 call that would copy or change live personal data (#111),
// and any D1 tool call or D1 API path on a
// database id that is not a literal main `DB` id in wrangler.jsonc.
// Exit code 2 blocks the tool call.
import { LIVE_DATA_MESSAGE, liveD1ApiReason, liveD1ToolReason } from './lib/live-data.mjs'
import { block, runGuard } from './lib/patterns.mjs'
import {
  SAFEGUARDING_MESSAGE,
  allowedDatabaseIds,
  cloudflareCallReason,
  restoresLiveDatabase,
  unknownD1Paths,
} from './lib/safeguarding.mjs'

await runGuard(async (input) => {
  const toolName = input.tool_name ?? ''
  const toolInput = input.tool_input ?? {}
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

  const reason = cloudflareCallReason(JSON.stringify(toolInput))
  if (reason) block(`this Cloudflare call is not allowed: ${reason}. ${SAFEGUARDING_MESSAGE}`)
  if (restoresLiveDatabase(JSON.stringify(toolInput), projectDir)) {
    block(
      'a Time Travel restore of a live database is founder-only: it also changes the safeguarding ' +
        `records. ${SAFEGUARDING_MESSAGE}`,
    )
  }

  // Live data stays on Cloudflare: only live metadata may be read (#111).
  const liveReason =
    liveD1ToolReason(toolName, toolInput, projectDir) ??
    liveD1ApiReason(JSON.stringify(toolInput), projectDir)
  if (liveReason) block(`this Cloudflare call is not allowed: ${liveReason}. ${LIVE_DATA_MESSAGE}`)

  // The D1 tools take a bare database id, so allow only ids we know are main databases.
  if (/d1_database/i.test(toolName) && toolInput.database_id) {
    const allowed = allowedDatabaseIds(projectDir)
    if (!allowed.has(String(toolInput.database_id).toLowerCase())) {
      block(
        `${toolName} on database ${toolInput.database_id}: only the main DB databases listed in ` +
          `wrangler.jsonc may be used through the D1 tools.`,
      )
    }
  }

  // The API tool can reach D1 by id too. Every D1 database path must use a
  // literal main DB id; one built at run time (for example by listing the
  // databases and looping over them) is refused.
  const code = typeof toolInput.code === 'string' ? toolInput.code : ''
  const unknown = unknownD1Paths(code, allowedDatabaseIds(projectDir))
  if (unknown.length > 0) {
    block(
      `this D1 API call uses database ${unknown.join(', ')}, which is not a literal main DB id ` +
        `from wrangler.jsonc.`,
    )
  }
})
