// Shared patterns for the Kinmeet Claude Code hooks.
// These are a safety net, not the control: GitHub secret scanning, push
// protection, a CI secret scan and branch protection sit behind them.

// Files that must never be written, read into the transcript or committed.
// Example files (`.env.example`, `.dev.vars.example`) are allowed.
const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.envrc$/,
  /(^|\/)\.dev\.vars(\.[^/]*)?$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)credentials(\.[^/]*)?$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml|txt)$/i,
]

// Wrangler's local state: agents must not write into it by hand, but may
// delete it, so it is only checked for file writes.
const LOCAL_STATE_PATTERN = /(^|\/)\.wrangler\//

const ALLOWED_EXAMPLES = /\.example$/

function normalise(path) {
  return path.replace(/\\/g, '/').replace(/^['"]|['"]$/g, '')
}

/** True for environment, key and credential files. */
export function isSecretFile(path) {
  const clean = normalise(path)
  if (ALLOWED_EXAMPLES.test(clean)) return false
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(clean))
}

/** True for files an agent must never write with a file tool. */
export function isProtectedWritePath(path) {
  return isSecretFile(path) || LOCAL_STATE_PATTERN.test(normalise(path))
}

// Content that looks like a credential. Where a pattern has a `value` group,
// only that group is checked against PLACEHOLDER, so a variable name such as
// `latestToken` cannot hide a real value.
const SECRET_CONTENT_PATTERNS = [
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  {
    name: 'GitHub token',
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', pattern: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic or OpenAI key', pattern: /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/ },
  {
    name: 'bearer token',
    pattern: /\bAuthorization['"]?\s*[:=]\s*['"]?Bearer\s+(?<value>[A-Za-z0-9_\-.=]{20,})/i,
  },
  {
    name: 'Cloudflare API token or key assignment',
    pattern:
      /\bCLOUDFLARE_(API_TOKEN|API_KEY|GLOBAL_API_KEY)['"]?\s*[=:]\s*['"]?(?<value>[A-Za-z0-9_-]{20,})/,
  },
  {
    // Matches `apiKey = "..."`, `api_key: '...'` and JSON or JSONC keys such
    // as `"apiToken": "..."`.
    name: 'hard-coded secret assignment',
    pattern:
      /\b[A-Za-z0-9_]*(secret|token|password|passwd|api[_-]?key)[A-Za-z0-9_]*['"]?\s*[=:]\s*['"](?<value>[A-Za-z0-9+/=_\-.]{20,})['"]/i,
  },
]

// Values that are obviously placeholders.
const PLACEHOLDER = /(example|placeholder|changeme|dummy|fake|test|xxxx|<[^>]+>|\$\{)/i

/** Returns the name and line of each likely secret. Never returns the secret itself. */
export function findSecrets(text) {
  const findings = []
  text.split('\n').forEach((line, index) => {
    for (const { name, pattern } of SECRET_CONTENT_PATTERNS) {
      const match = line.match(pattern)
      if (!match) continue
      const value = match.groups?.value ?? match[0]
      if (!PLACEHOLDER.test(value)) findings.push({ name, line: index + 1 })
    }
  })
  return findings
}

export async function readHookInput() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

/** Runs a guard; any unexpected error blocks the tool call rather than allowing it. */
export async function runGuard(guard) {
  try {
    await guard(await readHookInput())
    process.exit(0)
  } catch (error) {
    if (error?.blocked) console.error(`Blocked: ${error.message}`)
    else
      console.error(
        `Blocked: the Kinmeet safety hook failed (${error?.message ?? error}). Ask your EM.`,
      )
    process.exit(2)
  }
}

export function block(message) {
  const error = new Error(message)
  error.blocked = true
  throw error
}
