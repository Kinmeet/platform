#!/usr/bin/env bash
# Applies D1 migrations for one environment, if there are any.
# Usage: scripts/d1-migrate.sh <staging|live|preview>
#
# `preview` is the database every Preview of `platform` shares (ADR-0001). It
# is migrated only by builds of `main`, so an unmerged or abandoned migration
# never changes the database other Previews use. Other branches skip it and
# run on `main`'s schema until they merge.
set -euo pipefail

env="${1:?usage: scripts/d1-migrate.sh <staging|live|preview>}"
case "$env" in
  staging | live | preview) ;;
  *) echo "Unknown environment: $env" >&2; exit 2 ;;
esac

if ! compgen -G "migrations/db/*.sql" > /dev/null; then
  echo "No D1 migrations yet, nothing to apply."
  exit 0
fi

if [[ "$env" == preview ]]; then
  if [[ "${WORKERS_CI_BRANCH:-}" != main ]]; then
    echo "Preview migrations run only from builds of main; skipping for '${WORKERS_CI_BRANCH:-unknown}'."
    exit 0
  fi
  bunx wrangler d1 migrations apply PREVIEW_DB --remote --config wrangler.preview-migrations.jsonc
  exit 0
fi

# --config: after a build, Wrangler reads the generated config and ignores
# --env, so name the hand-kept file to make --env choose the database (ADR-0009).
bunx wrangler d1 migrations apply "kinmeet-$env" --env "$env" --remote --config wrangler.jsonc
