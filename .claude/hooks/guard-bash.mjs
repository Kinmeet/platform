// PreToolUse hook for Bash.
// - Blocks any command that names an environment or secret file, so secrets
//   are never written by redirection, copied, or read into the transcript.
// - Before a commit, scans everything that could land: tracked changes
//   against HEAD plus untracked, not-ignored files. This does not depend on
//   how the command is phrased (`git add . && git commit`, `git -C dir
//   commit`, pathspec commits).
// - Before a push, scans the commits the push would publish.
// - Blocks pushes to main, skipping git hooks, and live deploys by hand.
// - Blocks remote D1 commands and Cloudflare API calls that touch the
//   encrypted safeguarding table, `wrangler secret` commands on the
//   safeguarding key, and any `wrangler d1` or D1 API command on a database
//   that is not a main DB database (#89, #109).
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { block, findSecrets, isSecretFile, runGuard } from './lib/patterns.mjs'
import {
  SAFEGUARDING_KEY,
  SAFEGUARDING_MESSAGE,
  SAFEGUARDING_TABLE,
  allowedDatabases,
  cloudflareCallReason,
  unknownD1Paths,
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

// For the safeguarding check, only prose may be skipped: the message of a
// `git commit` and the title or body of a `gh pr` or `gh issue` command. Any
// other heredoc or quoted text is checked, because it could feed a query.
const PROSE_COMMAND = /\b(git\b[^;&|\n]*\bcommit|gh\s+(pr|issue))\b/

function withoutProse(command) {
  // Heredoc bodies first, judged by the line that opens them.
  const noProseHeredocs = command.replace(
    /(^|\n)([^\n]*?)<<-?\s*(['"]?)(\w+)\3[\s\S]*?\n\4(?=\s|$)/g,
    (heredoc, start, opener) => (PROSE_COMMAND.test(opener) ? `${start}${opener}` : heredoc),
  )
  // Then quoted -m, --body and --title values, within prose commands only.
  return noProseHeredocs
    .split(/(?=;|&&|\|\||\n)/)
    .map((part) => (PROSE_COMMAND.test(part) ? withoutMessages(part) : part))
    .join('')
}

// `wrangler d1 <command> <database>`: the database must be the DB binding, a
// main database name or a literal main id from wrangler.jsonc. Anything else,
// including a shell variable or command substitution, is refused.
const D1_NO_DATABASE = new Set(['list', 'create', '--help', '-h'])

function unknownD1Databases(command, projectDir) {
  const { ids, names } = allowedDatabases(projectDir)
  const words = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []
  const unknown = []
  for (let i = 0; i < words.length; i++) {
    if (words[i] !== 'd1' || !words.slice(Math.max(0, i - 3), i).some((w) => /wrangler$/.test(w)))
      continue
    let j = i + 1
    // `migrations apply`, `time-travel info` and similar take two words.
    if (['migrations', 'time-travel', 'insights'].includes(words[j])) j++
    if (D1_NO_DATABASE.has(words[i + 1])) continue
    j++
    while (j < words.length && words[j].startsWith('-')) j += words[j].includes('=') ? 1 : 2
    const database = (words[j] ?? '').replace(/^['"]|['"]$/g, '')
    if (!database || /[;&|]/.test(database)) {
      unknown.push('(missing)')
      continue
    }
    const known = names.has(database.toLowerCase()) || ids.has(database.toLowerCase())
    if (!known || /[$`]/.test(words[j])) unknown.push(database)
  }
  return unknown
}

// Why a command touches the safeguarding store, or null. Local D1 (`--local`,
// the default) holds made-up data, so only a remote D1 command, a Cloudflare
// API call or a `wrangler secret` command is checked. SQL in a `--file` is
// read so it is checked too.
function safeguardingReason(command, cwd) {
  if (/\bwrangler\b[\s\S]*\bd1\b/.test(command) && /--remote\b/.test(command)) {
    let sql = command
    for (const [, , path] of command.matchAll(/--file(?:=|\s+)(['"]?)([^\s'"]+)\1/g)) {
      const file = isAbsolute(path) ? path : join(cwd, path)
      if (existsSync(file) && statSync(file).isFile() && statSync(file).size <= MAX_SCAN_BYTES)
        sql += `\n${readFileSync(file, 'utf8')}`
    }
    if (SAFEGUARDING_TABLE.test(sql))
      return 'it touches the safeguarding_items table on a real database'
  }
  if (/\bwrangler\b[^;&|\n]*\bsecret\b/.test(command) && SAFEGUARDING_KEY.test(command))
    return 'it reads or sets a safeguarding key'
  if (/api\.cloudflare\.com/i.test(command)) return cloudflareCallReason(command)
  return null
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
    // A symlink to a directory (a linked node_modules, say) is not a file to scan.
    if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size > MAX_SCAN_BYTES)
      continue
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

  // Prose aside, heredocs and quoted text are checked too: they could feed a
  // query or an API call.
  const checked = withoutProse(fullCommand)
  const reason = safeguardingReason(checked, cwd)
  if (reason) block(`this command is not allowed: ${reason}. ${SAFEGUARDING_MESSAGE}`)
  const projectDir = process.env.CLAUDE_PROJECT_DIR || cwd
  const unknown = [
    ...unknownD1Databases(checked, projectDir),
    ...(/api\.cloudflare\.com/i.test(checked)
      ? unknownD1Paths(checked, allowedDatabases(projectDir).ids)
      : []),
  ]
  if (unknown.length > 0) {
    block(
      `this D1 command uses database ${unknown.join(', ')}, which is not the DB binding or a main ` +
        `database in wrangler.jsonc.`,
    )
  }

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
