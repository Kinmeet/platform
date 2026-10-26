// PreToolUse hook for Bash.
// - Blocks any command that names an environment or secret file, so secrets
//   are never written by redirection, copied, or read into the transcript.
// - Before a commit, scans everything that could land: tracked changes
//   against HEAD plus untracked, not-ignored files. This does not depend on
//   how the command is phrased (`git add . && git commit`, `git -C dir
//   commit`, pathspec commits).
// - Before a push, scans the commits the push would publish.
// - Blocks pushes to main, skipping git hooks, and live deploys by hand.
// - Blocks any D1 or Cloudflare API command that names a safeguarding
//   database or uses a safeguarding database id (#89).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { block, findSecrets, isSecretFile, runGuard } from './lib/patterns.mjs'
import {
  SAFEGUARDING_MESSAGE,
  safeguardingIds,
  safeguardingReason,
  usesSafeguardingId,
} from './lib/safeguarding.mjs'

const MAX_SCAN_BYTES = 1024 * 1024

// Message text (commit messages, PR titles and bodies) may mention `.env` or
// `--no-verify` in prose, so it is removed before the command is checked.
// Content is still scanned for secrets before a commit or push.
function withoutMessages(command) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[\s\S]*?\n\2(?=\s|$)/g, ' ')
    .replace(/(^|\s)(-m|--message|--body|--title|-b|-t)(\s+|=)("(?:[^"\\]|\\.)*"|'[^']*')/g, '$1')
}

function tokens(command) {
  // Split on whitespace and shell operators, and on `=` so `--file=.env` is seen.
  return command
    .split(/[\s;&|()<>=]+/)
    .map((token) => token.replace(/^['"]+|['"]+$/g, ''))
    .filter(Boolean)
}

function gitDir(command, cwd) {
  const match = command.match(/\bgit\s+(?:-c\s+\S+\s+)*-C\s+(\S+)/)
  if (!match) return cwd
  const dir = match[1].replace(/^['"]|['"]$/g, '')
  return isAbsolute(dir) ? dir : join(cwd, dir)
}

function git(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
}

function tryGit(cwd, args) {
  try {
    return git(cwd, args)
  } catch {
    return null
  }
}

function addedLines(diff) {
  return diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
    .join('\n')
}

function check(files, text, when) {
  const secretFiles = files.filter(isSecretFile)
  if (secretFiles.length > 0) {
    block(
      `${when} would include secret or environment files: ${secretFiles.join(', ')}. Remove or unstage them.`,
    )
  }
  const findings = findSecrets(text)
  if (findings.length > 0) {
    const names = [...new Set(findings.map((f) => f.name))].join(', ')
    block(
      `${when} would include something that looks like a secret (${names}). Remove it, and if it was ever ` +
        'real, tell your EM so it can be rotated.',
    )
  }
}

function scanBeforeCommit(cwd) {
  const hasHead = tryGit(cwd, ['rev-parse', '--verify', 'HEAD']) !== null
  const base = hasHead ? ['diff', 'HEAD'] : ['diff', '--cached']
  const changed = (tryGit(cwd, [...base, '--name-only', '--diff-filter=ACMR']) ?? '')
    .split('\n')
    .filter(Boolean)
  const untracked = (tryGit(cwd, ['ls-files', '--others', '--exclude-standard']) ?? '')
    .split('\n')
    .filter(Boolean)

  let text = addedLines(tryGit(cwd, [...base, '--unified=0', '--diff-filter=ACMR']) ?? '')
  for (const file of untracked) {
    const path = join(cwd, file)
    if (!existsSync(path) || statSync(path).size > MAX_SCAN_BYTES) continue
    text += `\n${readFileSync(path, 'utf8')}`
  }
  check([...changed, ...untracked], text, 'this commit')
}

function scanBeforePush(cwd) {
  // Compare with main as last fetched; with no remote main, scan everything
  // since the empty tree.
  const emptyTree = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
  const range =
    tryGit(cwd, ['rev-parse', '--verify', 'origin/main']) !== null
      ? 'origin/main...HEAD'
      : `${emptyTree}..HEAD`
  const files = (tryGit(cwd, ['diff', '--name-only', '--diff-filter=ACMR', range]) ?? '')
    .split('\n')
    .filter(Boolean)
  const text = addedLines(tryGit(cwd, ['diff', '--unified=0', '--diff-filter=ACMR', range]) ?? '')
  check(files, text, 'this push')
}

await runGuard(async (input) => {
  const fullCommand = input.tool_input?.command ?? ''
  const command = withoutMessages(fullCommand)
  const cwd = input.cwd || process.cwd()

  const named = tokens(command).filter(isSecretFile)
  if (named.length > 0) {
    block(
      `this command names a secret or environment file (${[...new Set(named)].join(', ')}). Agents never read, ` +
        'write, copy or move these files. Use a .example file, or ask your EM.',
    )
  }

  // Searching code for the binding name is fine; reaching the database is not.
  // A known safeguarding id is blocked wherever it appears.
  const ids = safeguardingIds()
  const reachesD1 = /\bd1\b|api\.cloudflare\.com/i.test(command)
  const reason = reachesD1
    ? safeguardingReason(command, ids)
    : usesSafeguardingId(command, ids) && 'it uses a safeguarding database id'
  if (reason) block(`this command is not allowed: ${reason}. ${SAFEGUARDING_MESSAGE}`)

  if (/\bwrangler\b[^;&|]*\bdeploy\b[^;&|]*(--env[=\s]+live\b|-e[=\s]+live\b)/.test(command)) {
    block('live deploys happen only from an approved tagged release in CI, never by hand.')
  }

  if (!/\bgit\b/.test(command)) return

  if (
    /\bgit\b[^;&|]*\s--no-verify\b/.test(command) ||
    /\bgit\b[^;&|]*\bcommit\b[^;&|]*\s-n\b/.test(command)
  ) {
    block('do not skip git hooks (--no-verify). Fix what the hook reports instead.')
  }

  if (/\bgit\b[^;&|]*\bpush\b[^;&|]*(\s|:)(main|master)(?=\s|$|[;&|])/.test(command)) {
    block('never push to main. Push your branch and open a pull request.')
  }

  const dir = gitDir(command, cwd)
  if (/\bgit\b[^;&|]*\bcommit\b/.test(command)) scanBeforeCommit(dir)
  if (/\bgit\b[^;&|]*\bpush\b/.test(command)) scanBeforePush(dir)
})
