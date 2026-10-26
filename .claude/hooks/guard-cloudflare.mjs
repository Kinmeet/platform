// PreToolUse hook for the Cloudflare MCP tools (the Cloudflare API `execute`
// tool and the older Workers Bindings D1 tools). Blocks any call that names a
// safeguarding database or uses a safeguarding database id (#89), and any
// direct D1 tool call on a database id that is not one of the main `DB` ids in
// wrangler.jsonc, because safeguarding ids are kept out of the repository.
// Exit code 2 blocks the tool call.
import { block, runGuard } from './lib/patterns.mjs'
import {
  SAFEGUARDING_MESSAGE,
  allowedDatabaseIds,
  safeguardingIds,
  safeguardingReason,
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

  // The API tool can reach D1 by id too, so the same rule applies to any D1
  // database id it mentions.
  const code = typeof toolInput.code === 'string' ? toolInput.code : ''
  if (/\/d1\/database/i.test(code)) {
    const allowed = allowedDatabaseIds(projectDir)
    const ids = code.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi) ?? []
    const unknown = ids.filter((id) => !allowed.has(id.toLowerCase()))
    if (unknown.length > 0) {
      block(
        `this D1 API call uses database ${unknown.join(', ')}, which is not a main DB database in ` +
          `wrangler.jsonc. ${SAFEGUARDING_MESSAGE}`,
      )
    }
  }
})
