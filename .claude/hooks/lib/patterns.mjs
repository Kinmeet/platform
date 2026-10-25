// Shared patterns for the Kinmeet Claude Code hooks.
// Kept deliberately simple: these are a safety net, not a replacement for
// GitHub secret scanning and push protection.

// Files that must never be written by an agent or committed.
// Example files (`.env.example`, `.dev.vars.example`) are allowed.
const SECRET_FILE_PATTERNS = [
  /(^|\/)\.env(\.[^/]*)?$/,
  /(^|\/)\.dev\.vars(\.[^/]*)?$/,
  /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /(^|\/)\.npmrc$/,
  /(^|\/)credentials(\.[^/]*)?$/i,
  /(^|\/)secrets?\.(json|ya?ml|toml|txt)$/i,
  /(^|\/)\.wrangler\//,
];

const ALLOWED_EXAMPLES = /\.example$/;

export function isSecretFile(path) {
  const normalised = path.replace(/\\/g, '/');
  if (ALLOWED_EXAMPLES.test(normalised)) return false;
  return SECRET_FILE_PATTERNS.some((pattern) => pattern.test(normalised));
}

// Content that looks like a credential. Each entry has a name for the message.
const SECRET_CONTENT_PATTERNS = [
  { name: 'private key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'GitHub token', pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/ },
  { name: 'AWS access key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Slack token', pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe live key', pattern: /\b[sr]k_live_[A-Za-z0-9]{20,}\b/ },
  { name: 'Anthropic or OpenAI key', pattern: /\bsk-(ant-)?[A-Za-z0-9_-]{32,}\b/ },
  {
    name: 'Cloudflare API token or key assignment',
    pattern: /\bCLOUDFLARE_(API_TOKEN|API_KEY|GLOBAL_API_KEY)\s*[=:]\s*['"]?[A-Za-z0-9_-]{20,}/,
  },
  {
    name: 'hard-coded secret assignment',
    pattern:
      /\b[A-Za-z0-9_]*(secret|token|password|passwd|api[_-]?key)[A-Za-z0-9_]*\s*[=:]\s*['"][A-Za-z0-9+/=_\-.]{20,}['"]/i,
  },
];

// Values that are obviously placeholders or public test keys.
const PLACEHOLDER = /(example|placeholder|changeme|dummy|fake|test|xxxx|<[^>]+>|\$\{)/i;

export function findSecrets(text) {
  const findings = [];
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const { name, pattern } of SECRET_CONTENT_PATTERNS) {
      const match = line.match(pattern);
      if (match && !PLACEHOLDER.test(match[0])) {
        findings.push({ name, line: index + 1 });
      }
    }
  });
  return findings;
}

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
