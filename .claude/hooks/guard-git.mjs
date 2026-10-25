// PreToolUse hook for Bash.
// Before `git commit`: scans the staged diff for secret files and likely
// credentials. Also blocks pushes to main and skipping git hooks.
import { execFileSync } from 'node:child_process';
import { findSecrets, isSecretFile, readHookInput } from './lib/patterns.mjs';

const input = await readHookInput();
const command = input.tool_input?.command ?? '';

function block(message) {
  console.error(`Blocked: ${message}`);
  process.exit(2);
}

function git(args) {
  return execFileSync('git', args, { cwd: input.cwd || process.cwd(), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

if (!/\bgit\b/.test(command)) process.exit(0);

if (/\bgit\b[^;&|]*\s--no-verify\b/.test(command) || /\bgit\s+commit\b[^;&|]*\s-n\b/.test(command)) {
  block('do not skip git hooks (--no-verify). Fix what the hook reports instead.');
}

if (/\bgit\s+push\b[^;&|]*(\s|:)(main|master)(?=\s|$|[;&|])/.test(command)) {
  block('never push to main. Push your branch and open a pull request.');
}

if (/\bgit\s+commit\b/.test(command)) {
  // `git commit -a` / `--all` stages tracked changes at commit time, so include them.
  const includesUnstaged = /\bgit\s+commit\b[^;&|]*\s(-[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(command);
  const diffArgs = includesUnstaged ? ['diff', 'HEAD'] : ['diff', '--cached'];

  let files = [];
  let diff = '';
  try {
    files = git([...diffArgs, '--name-only', '--diff-filter=ACMR']).split('\n').filter(Boolean);
    diff = git([...diffArgs, '--unified=0', '--diff-filter=ACMR']);
  } catch {
    // Not a git repository or no HEAD yet: nothing to scan.
    process.exit(0);
  }

  const secretFiles = files.filter(isSecretFile);
  if (secretFiles.length > 0) {
    block(`the commit includes secret or environment files: ${secretFiles.join(', ')}. Unstage them.`);
  }

  const added = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n');
  const findings = findSecrets(added);
  if (findings.length > 0) {
    const names = [...new Set(findings.map((f) => f.name))].join(', ');
    block(
      `the staged changes look like they contain a secret (${names}). Remove it, and if it was ever real, ` +
        'tell your EM so it can be rotated.',
    );
  }
}

process.exit(0);
