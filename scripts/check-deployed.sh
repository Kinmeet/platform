#!/usr/bin/env bash
# Checks a deployed environment answers and sends the security headers we rely on.
# Runs on a GitHub runner after every Workers Builds deploy, because the team's own
# sessions cannot reach workers.dev.
# Usage: scripts/check-deployed.sh <base-url>
set -euo pipefail

base="${1:?usage: scripts/check-deployed.sh <base-url>}"
headers="$(mktemp)"
trap 'rm -f "$headers"' EXIT

# The new version can take a few seconds to reach every location.
for attempt in 1 2 3 4 5; do
  status="$(curl --silent --show-error --output /dev/null --dump-header "$headers" \
    --write-out '%{http_code}' "$base/")" || status=000
  [ "$status" = 200 ] && break
  echo "Attempt $attempt: $base/ returned $status, retrying."
  sleep 5
done

if [ "$status" != 200 ]; then
  echo "::error::$base/ returned $status."
  exit 1
fi

# Header values from P5 (security design), "Hardening the site".
check() {
  local name="$1" pattern="$2"
  if ! grep -iE "^$name:" "$headers" | grep -qiE "$pattern"; then
    echo "::error::Header $name is missing or does not match: $pattern"
    failed=1
  fi
}
failed=0
check content-security-policy "default-src 'self'"
check content-security-policy "frame-ancestors 'none'"
check strict-transport-security "max-age=[0-9]+.*preload"
check referrer-policy "no-referrer"
check permissions-policy "camera=\(\).*microphone=\(\)|microphone=\(\).*camera=\(\)"
check permissions-policy "geolocation=\(\)"
check x-content-type-options "nosniff"

echo "Response headers from $base/:"
cat "$headers"
exit "$failed"
