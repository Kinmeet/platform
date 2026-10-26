// PreToolUse hook for file-writing tools: Write, Edit, MultiEdit,
// NotebookEdit, and the GitHub tools that commit files directly
// (create_or_update_file, push_files), which never pass through git hooks.
// Blocks writes to environment and secret files, and content that looks
// like a credential. Exit code 2 blocks the tool call.
import { block, findSecrets, isProtectedWritePath, runGuard } from './lib/patterns.mjs'

function filesFrom(toolInput) {
  if (Array.isArray(toolInput.files)) {
    return toolInput.files.map((file) => ({ path: file.path ?? '', content: file.content ?? '' }))
  }
  const path = toolInput.file_path ?? toolInput.notebook_path ?? toolInput.path ?? ''
  const content = [
    toolInput.content,
    toolInput.new_string,
    toolInput.new_source,
    ...(toolInput.edits ?? []).map((edit) => edit.new_string),
  ]
    .filter((part) => typeof part === 'string')
    .join('\n')
  return [{ path, content }]
}

await runGuard(async (input) => {
  for (const { path, content } of filesFrom(input.tool_input ?? {})) {
    if (path && isProtectedWritePath(path)) {
      block(
        `${path} is an environment, secret or local state file. Secrets live only as Worker secrets ` +
          '(wrangler secret put) or GitHub Actions secrets. Use a .example file for documented placeholders.',
      )
    }
    const findings = findSecrets(content)
    if (findings.length > 0) {
      const summary = findings.map((f) => `${f.name} (line ${f.line} of the new text)`).join(', ')
      block(
        `the new content for ${path || 'this file'} looks like it contains a secret: ${summary}. ` +
          'Never put secrets in the repository. If this is a false positive, use an obviously fake placeholder value.',
      )
    }
  }
})
