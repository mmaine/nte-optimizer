#!/usr/bin/env sh
# Build and publish to [removed].
#
# The homelab has no rsync, so the tree goes over as a tar stream. Caddy serves
# /mnt/docker/appdata/caddy/sites/[removed] as /srv/[removed] (a
# read-only bind mount declared in /mnt/docker/compose/caddy/docker-compose.yml),
# so a deploy is a file copy - no container restart, no config reload.
set -eu

HOST="${DEPLOY_HOST:-hl}"
DEST="${DEPLOY_DEST:-/mnt/docker/appdata/caddy/sites/[removed]}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

cd "$ROOT"
rm -rf dist
# build:single runs the hosted build first, so this produces both targets.
npm run build:single

# Replace rather than merge: a stale content-hashed chunk left behind would be
# served forever, since /assets/* is cached as immutable.
tar -C dist -cz . | ssh "$HOST" "rm -rf '$DEST'/* && tar -C '$DEST' -xz"

printf '\ndeployed. checking...\n'
curl -fsS -o /dev/null -w '[removed] -> %{http_code}\n' [removed]
curl -fsS -o /dev/null -w '[removed] -> %{http_code} (%{size_download} bytes)\n' [removed]
