#!/usr/bin/env sh
# Build and publish to a user-supplied static host.
set -eu

: "${DEPLOY_HOST:?set DEPLOY_HOST}"
: "${DEPLOY_DEST:?set DEPLOY_DEST}"
HOST="$DEPLOY_HOST"
DEST="$DEPLOY_DEST"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
rm -rf dist
# build:single runs the hosted build first, so this produces both targets.
npm run build:single

# Replace rather than merge: a stale content-hashed chunk left behind would be
# served forever, since /assets/* is cached as immutable.
tar -C dist -cz . | ssh "$HOST" "rm -rf '$DEST'/* && tar -C '$DEST' -xz"

if [ -n "${DEPLOY_URL:-}" ]; then
  curl -fsS -o /dev/null -w '%{http_code}\n' "$DEPLOY_URL"
fi
