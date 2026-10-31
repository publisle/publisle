#!/usr/bin/env bash
# Runner side of the reviewer-gated host sync. The key it uses can only run
# publisle-host-sync on the server, which fetches files from GitHub by commit.
# Nothing is uploaded from here.
set -euo pipefail
: "${PDF_DEPLOY_HOST:?Configure the production deployment host}"
: "${PDF_HOST_SYNC_USER:?Configure the host-sync SSH user}"
: "${PDF_HOST_SYNC_KEY:?Configure the host-sync SSH key}"
: "${PDF_DEPLOY_HOST_KEY:?Pin the production SSH host key}"
: "${GITHUB_SHA:?An immutable source is required}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$PDF_DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ && "$PDF_HOST_SYNC_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
printf '%s\n' "$PDF_HOST_SYNC_KEY" > "$STAGE/key"
chmod 600 "$STAGE/key"
printf '%s\n' "$PDF_DEPLOY_HOST_KEY" > "$STAGE/known_hosts"
ssh -i "$STAGE/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$STAGE/known_hosts" \
  "$PDF_HOST_SYNC_USER@$PDF_DEPLOY_HOST" "sync $GITHUB_SHA"
