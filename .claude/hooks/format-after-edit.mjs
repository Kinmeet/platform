// PostToolUse hook for Write, Edit and MultiEdit.
// Formats the edited file with Prettier and lints it with ESLint.
// Problems are reported back to the agent (exit code 2) so it fixes them.
// Tool output is not passed through, so file contents never reach the
// transcript. Skips quietly when dependencies are not installed yet.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readHookInput } from './lib/patterns.mjs';

const input = await readHookInput();
const path = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();

if (!path || !existsSync(path)) process.exit(0);
const rel = relative(root, path);
if (rel.startsWith('..') || /(^|\/)(node_modules|\.nuxt|\.output|dist)\//.test(rel)) process.exit(0);

const bin = (name) => join(root, 'node_modules', '.bin', name);

if (existsSync(bin('prettier'))) {
  const result = spawnSync(bin('prettier'), ['--write', '--ignore-unknown', '--log-level', 'silent', path], {
    cwd: root,
    stdio: 'ignore',
  });
  if (result.status !== 0) {
    console.error(`Prettier could not format ${rel}. Check the file for syntax errors.`);
    process.exit(2);
  }
}

if (existsSync(bin('eslint')) && /\.(m?[jt]sx?|vue)$/.test(path)) {
  // The formatter prints rule ids and positions only, never source lines.
  const result = spawnSync(bin('eslint'), ['--fix', '--no-warn-ignored', '--format', 'unix', path], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status === 1) {
    console.error(`ESLint found problems in ${rel} that it could not fix:\n${result.stdout}`);
    process.exit(2);
  }
}

process.exit(0);
