#!/usr/bin/env bash
set -euo pipefail
: "${PDF_DEPLOY_HOST:?Configure the production deployment host}"
: "${PDF_DEPLOY_USER:?Configure the restricted deployment user}"
: "${PDF_DEPLOY_KEY:?Configure the dedicated deployment SSH key}"
: "${PDF_DEPLOY_HOST_KEY:?Pin the production SSH host key}"
: "${GITHUB_SHA:?An immutable release source is required}"
: "${GITHUB_REPOSITORY:?The repository that owns the release record is required}"
: "${GH_TOKEN:?A token that may write commit statuses is required}"
[[ "$GITHUB_SHA" =~ ^[a-f0-9]{40}$ && "$PDF_DEPLOY_HOST" =~ ^[A-Za-z0-9.-]+$ && "$PDF_DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]*$ ]]
STAGE=$(mktemp -d)
STAGED=false
# The deploy key reaches the server only through a forced command that accepts
# status, stage, activate and cleanup (deploy/vps/publisle-receive).
remote() { ssh "${SSH_ARGS[@]}" "$PDF_DEPLOY_USER@$PDF_DEPLOY_HOST" "$1"; }
cleanup() {
  if [[ $STAGED == true ]]; then remote "cleanup $GITHUB_SHA" || true; fi
  rm -rf "$STAGE"
}
trap cleanup EXIT
printf '%s\n' "$PDF_DEPLOY_KEY" > "$STAGE/key"
chmod 600 "$STAGE/key"
printf '%s\n' "$PDF_DEPLOY_HOST_KEY" > "$STAGE/known_hosts"
SSH_ARGS=(-i "$STAGE/key" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$STAGE/known_hosts")
# A retry of an older release must not roll back a newer successful deployment.
CURRENT=$(remote status)
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
# (automatic dates, empty reference headings, late table floats, clipped code
# lines). Activation loads it, verifies it inside the resource budget, and points
# PDF_WORKER_IMAGE at it, so the release goes live without an operator step.
LATEX_TAG="publisle-pdf-worker:$GITHUB_SHA"
docker build -f deploy/vps/worker.Dockerfile -t "$LATEX_TAG" .
LATEX_ID=$(docker image inspect --format '{{.Id}}' "$LATEX_TAG")
[[ "$LATEX_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
docker run --rm --entrypoint sh "$LATEX_ID" -c 'grep -q placeins /app/worker.mjs' || {
  echo "LaTeX worker bundle is missing the placeins dependency." >&2
  exit 1
}
docker save "$LATEX_TAG" | gzip -1 > "$STAGE/latex-image.tar.gz"
git archive --format=tar --prefix=source/ "$GITHUB_SHA" > "$STAGE/source.tar"
# Record one digest over exactly the bytes that are about to be uploaded. The
# server fetches this commit status itself and refuses a bundle that differs, so a
# stolen SSH key cannot make it activate an archive the release job never built.
IMAGE_SHA=$(sha256sum "$STAGE/image.tar.gz" | cut -d' ' -f1)
LATEX_SHA=$(sha256sum "$STAGE/latex-image.tar.gz" | cut -d' ' -f1)
SOURCE_SHA=$(sha256sum "$STAGE/source.tar" | cut -d' ' -f1)
RELEASE_DIGEST=$(printf 'image=%s\nlatex=%s\nsource=%s\n' "$IMAGE_SHA" "$LATEX_SHA" "$SOURCE_SHA" | sha256sum | cut -d' ' -f1)
gh api --method POST "repos/$GITHUB_REPOSITORY/statuses/$GITHUB_SHA" \
  -f state=success -f context=publisle-pdf-release \
  -f description="publisle-pdf-release sha256:$RELEASE_DIGEST" >/dev/null
STAGED=true
tar -C "$STAGE" -cf - image.tar.gz latex-image.tar.gz source.tar | remote "stage $GITHUB_SHA"
remote "activate $GITHUB_SHA"
