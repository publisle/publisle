#!/usr/bin/env bash
set -euo pipefail
: "${PDF_DEPLOY_HOST:?Configure the production deployment host}"
: "${PDF_DEPLOY_USER:?Configure the restricted deployment user}"
: "${PDF_DEPLOY_KEY:?Configure the dedicated deployment SSH key}"
: "${PDF_DEPLOY_HOST_KEY:?Pin the production SSH host key}"
: "${GITHUB_SHA:?An immutable release source is required}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$PDF_DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ && "$PDF_DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
printf '%s\n' "$PDF_DEPLOY_KEY" > "$STAGE/key"
chmod 600 "$STAGE/key"
printf '%s\n' "$PDF_DEPLOY_HOST_KEY" > "$STAGE/known_hosts"
SSH_ARGS=(-i "$STAGE/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$STAGE/known_hosts")
# A retry of an older release must not roll back a newer successful deployment.
CURRENT=$(ssh "${SSH_ARGS[@]}" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST" 'if [ -f /etc/publisle-deployed-release ]; then cat /etc/publisle-deployed-release; fi')
if [[ -n "$CURRENT" && "$CURRENT" != "$GITHUB_SHA" ]]; then
  [[ "$CURRENT" =~ ^[a-f0-9]{40}$ ]]
  if git merge-base --is-ancestor "$GITHUB_SHA" "$CURRENT"; then
    echo "A newer source is already deployed; skipping this older deployment."
    exit 0
  fi
  git merge-base --is-ancestor "$CURRENT" "$GITHUB_SHA"
fi
pnpm --filter @publisle/pdf-service build
BUILD_TAG="publisle-pdf-release:$GITHUB_SHA"
docker build -f deploy/vps/native-worker.Dockerfile -t "$BUILD_TAG" .
# The compiler in the deployment image must be the published Linux compiler.
CID=$(docker create "$BUILD_TAG")
docker cp "$CID:/usr/local/bin/publisle-pdf" "$STAGE/compiler"
docker rm "$CID"
node --input-type=module - "$STAGE/compiler" <<'JS'
import {readFileSync} from 'node:fs';import{createHash}from'node:crypto';import{execFileSync}from'node:child_process';
const version=JSON.parse(readFileSync('packages/research/package.json')).optionalDependencies['@publisle/pdf-native-linux-x64'];
const cwd=process.env.RUNNER_TEMP;
const result=JSON.parse(execFileSync('npm',['pack',`@publisle/pdf-native-linux-x64@${version}`,'--ignore-scripts','--json'],{cwd,encoding:'utf8'}));
const manifest=JSON.parse(execFileSync('tar',['-xOf',`${cwd}/${result[0].filename}`,'package/artifact.json'],{encoding:'utf8'}));
if(createHash('sha256').update(readFileSync(process.argv[2])).digest('hex')!==manifest.files['bin/publisle-pdf'])throw Error('Deployment compiler differs from the published compiler');
JS
docker save "$BUILD_TAG" | gzip -1 > "$STAGE/image.tar.gz"
# The LaTeX worker image carries the TypeScript template rendering, so it must
# move with every release too; a stale image re-introduces fixed LaTeX bugs
# (automatic dates, empty reference headings, late table floats). It is only
# staged on the host: activation stays behind the operator's verification gate.
LATEX_TAG="publisle-pdf-worker:$GITHUB_SHA"
docker build -f deploy/vps/worker.Dockerfile -t "$LATEX_TAG" .
LATEX_ID=$(docker image inspect --format '{{.Id}}' "$LATEX_TAG")
[[ "$LATEX_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
docker run --rm --entrypoint sh "$LATEX_ID" -c 'grep -q placeins /app/worker.mjs' || {
  echo "LaTeX worker bundle is missing the placeins dependency." >&2
  exit 1
}
docker save "$LATEX_TAG" | gzip -1 > "$STAGE/latex-image.tar.gz"
# Transport the portable configuration digest, not a daemon-specific image ID.
IMAGE=$(tar -xzOf "$STAGE/image.tar.gz" manifest.json | node --input-type=module -e '
import {readFileSync} from "node:fs";
import assert from "node:assert/strict";
const entries=JSON.parse(readFileSync(0,"utf8"));assert(entries.length===1);
const match=/^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/.exec(entries[0].Config);
assert(match);console.log(`sha256:${match[1]??match[2]}`);
')
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
git archive --format=tar --prefix=source/ "$GITHUB_SHA" > "$STAGE/source.tar"
REMOTE="/var/tmp/publisle-deploy-$GITHUB_SHA"
ssh "${SSH_ARGS[@]}" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST" "mkdir -p '$REMOTE'"
scp "${SSH_ARGS[@]}" "$STAGE/image.tar.gz" "$STAGE/latex-image.tar.gz" "$STAGE/source.tar" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST:$REMOTE/"
ssh "${SSH_ARGS[@]}" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST" "tar -xf '$REMOTE/source.tar' -C '$REMOTE' && sudo -n /usr/local/sbin/publisle-deploy '$GITHUB_SHA' '$IMAGE'"

# Remove only this run's uploaded archive after activation; retain server reports.
ssh "${SSH_ARGS[@]}" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST" "rm -rf '$REMOTE'"
