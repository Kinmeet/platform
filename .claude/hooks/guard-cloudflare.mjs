// PreToolUse hook for the Cloudflare MCP tools (the Cloudflare API `execute`
// tool and the older Workers Bindings D1 tools). Blocks any call that names a
// safeguarding database or uses a safeguarding database id (#89), and any
// D1 tool call or D1 API path on a database id that is not a literal main `DB`
// id in wrangler.jsonc, because safeguarding ids are kept out of the repository.
// Exit code 2 blocks the tool call.
import { block, runGuard } from './lib/patterns.mjs'
import {
  SAFEGUARDING_MESSAGE,
  allowedDatabaseIds,
  safeguardingIds,
  safeguardingReason,
  unknownD1Paths,
} from './lib/safeguarding.mjs'

await runGuard(async (input) => {
  const toolName = input.tool_name ?? ''
  const toolInput = input.tool_input ?? {}
  const projectDir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()

  const reason = safeguardingReason(JSON.stringify(toolInput), safeguardingIds())
  if (reason) block(`this Cloudflare call is not allowed: ${reason}. ${SAFEGUARDING_MESSAGE}`)

  // The D1 tools take a bare database id, so allow only ids we know are main databases.
  if (/d1_database/i.test(toolName) && toolInput.database_id) {
    const allowed = allowedDatabaseIds(projectDir)
    if (!allowed.has(String(toolInput.database_id).toLowerCase())) {
      block(
        `${toolName} on database ${toolInput.database_id}: only the main DB databases listed in ` +
          `wrangler.jsonc may be used through the D1 tools. ${SAFEGUARDING_MESSAGE}`,
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
        `from wrangler.jsonc. ${SAFEGUARDING_MESSAGE}`,
    )
  }
})
