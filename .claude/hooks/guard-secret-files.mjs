// PreToolUse hook for Write, Edit and MultiEdit.
// Blocks writes to environment and secret files, and blocks content that
// looks like a credential. Exit code 2 blocks the tool call and shows the
// message to the agent.
import { findSecrets, isSecretFile, readHookInput } from './lib/patterns.mjs';

const input = await readHookInput();
const toolInput = input.tool_input ?? {};
const path = toolInput.file_path ?? toolInput.notebook_path ?? '';

if (path && isSecretFile(path)) {
  console.error(
    `Blocked: ${path} is an environment or secret file. Secrets live only as Worker secrets ` +
      '(wrangler secret put) or GitHub Actions secrets. Use a .example file for documented placeholders.',
  );
  process.exit(2);
}

const content = [
  toolInput.content,
  toolInput.new_string,
  ...(toolInput.edits ?? []).map((edit) => edit.new_string),
]
  .filter(Boolean)
  .join('\n');

const findings = findSecrets(content);
if (findings.length > 0) {
  const summary = findings.map((f) => `${f.name} (line ${f.line} of the new text)`).join(', ');
  console.error(
    `Blocked: the new content for ${path || 'this file'} looks like it contains a secret: ${summary}. ` +
      'Never put secrets in the repository. If this is a false positive, use an obviously fake placeholder.',
  );
  process.exit(2);
}

process.exit(0);
