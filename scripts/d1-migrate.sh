#!/usr/bin/env bash
# Applies D1 migrations for one environment (staging or live), if there are any.
# Usage: scripts/d1-migrate.sh <staging|live>
set -euo pipefail

env="${1:?usage: scripts/d1-migrate.sh <staging|live>}"
case "$env" in
  staging | live) ;;
  *) echo "Unknown environment: $env" >&2; exit 2 ;;
esac

if ! compgen -G "migrations/*.sql" > /dev/null; then
  echo "No D1 migrations yet, nothing to apply."
  exit 0
fi

npx wrangler d1 migrations apply "kinmeet-$env" --env "$env" --remote
