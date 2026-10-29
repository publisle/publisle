#!/usr/bin/env bash
# Install this root-owned as /usr/local/sbin/publisle-deploy. Grant the dedicated
# deploy user sudo access to this entry point only, never to arbitrary scripts.
set -euo pipefail
# BEGIN prune_rollbacks
# Follow-up for #119: rollback directories used to accumulate. Keep the newest
# three by mtime, and never remove the snapshot taken for this activation.
prune_rollbacks() {
  local root=$1
  local current=$2
  local -a ranked=()
  local entry
  while IFS= read -r entry; do
    [[ -n "$entry" ]] || continue
    ranked+=("$entry")
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -name 'rollback-*' -printf '%T@ %p\n' | sort -nr | cut -d' ' -f2-)
  local index=0
  local path
  for path in "${ranked[@]}"; do
    index=$((index + 1))
    if (( index <= 3 )) || [[ $path == "$current" ]]; then
      continue
    fi
    rm -rf -- "$path"
  done
}
# END prune_rollbacks
[[ $EUID -eq 0 && ${1:-} =~ ^[a-f0-9]{40}$ && ${2:-} =~ ^sha256:[a-f0-9]{64}$ ]]
RELEASE_SHA=$1
IMAGE=$2
UPLOAD="/var/tmp/publisle-deploy-$RELEASE_SHA"
[[ -d "$UPLOAD/source/deploy/vps" && ! -L "$UPLOAD" ]]
# Snapshot without dereferencing links, then validate the private copy. The CI
# identity cannot race privileged activation by rewriting the upload directory.
install -d -o root -g root -m 0755 /var/lib/publisle-releases
STAGE=$(mktemp -d "/var/lib/publisle-releases/$RELEASE_SHA.XXXXXX")
cp -a --no-dereference "$UPLOAD/source" "$UPLOAD/image.tar.gz" "$UPLOAD/latex-image.tar.gz" "$STAGE/"
[[ -z $(find "$STAGE" ! -type f ! -type d -print -quit) ]]
command -v java >/dev/null
command -v pdftotext >/dev/null
UID_PUBLISLE=$(id -u publisle)
RUNTIME=(--setenv=HOME=/var/lib/publisle-runtime --setenv="XDG_RUNTIME_DIR=/run/user/$UID_PUBLISLE" --setenv="DOCKER_HOST=unix:///run/user/$UID_PUBLISLE/docker.sock")
# Runtime validation may write its outputs and dependencies, but it must never
# replace source files that root later installs into the live service.
chown -R root:root "$STAGE"
chown root:publisle "$STAGE" "$STAGE/image.tar.gz" "$STAGE/latex-image.tar.gz"
chmod 750 "$STAGE"
chmod 640 "$STAGE/image.tar.gz" "$STAGE/latex-image.tar.gz"
chmod -R go-w "$STAGE/source"
VALIDATION="$STAGE/validation"
install -d -o publisle -g publisle -m 0750 "$VALIDATION"
chown -R publisle:publisle "$STAGE/source/deploy/vps/qa"
function bounded() {
  systemd-run --unit="publisle-release-$RELEASE_SHA-$1" --wait --pipe --collect --uid=publisle --gid=publisle --working-directory="$STAGE/source" --slice=publisle-pdf.slice -p MemoryMax=320M -p MemorySwapMax=0 -p RuntimeMaxSec=1800 -p TimeoutStopSec=30 "${RUNTIME[@]}" --setenv="JAVA_TOOL_OPTIONS=-Xmx128m -XX:ActiveProcessorCount=1" "${@:2}"
}
# Classic Docker IDs identify image configuration; containerd reports an OCI
# manifest ID after loading the same archive. Bind the archived tag to the
# expected configuration, then resolve the immutable ID on this daemon.
METADATA=$(bounded metadata /usr/bin/tar -xzOf "$STAGE/image.tar.gz" manifest.json)
ARCHIVE_TAG=$(/usr/bin/node --input-type=module - "$METADATA" "$IMAGE" "$RELEASE_SHA" <<'JS'
import assert from 'node:assert/strict';
const entries=JSON.parse(process.argv[2]);
assert(entries.length===1);
const entry=entries[0];
const config=/^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/.exec(entry.Config);
assert(config&&`sha256:${config[1]??config[2]}`===process.argv[3], 'Archive configuration does not match the expected image');
assert(entry.RepoTags?.length===1);
const tag=entry.RepoTags[0];
assert(tag==='publisle-pdf-release:latest'||tag===`publisle-pdf-release:${process.argv[4]}`);
console.log(tag);
JS
)
bounded load /usr/bin/docker load -i "$STAGE/image.tar.gz"
IMAGE=$(bounded resolve /usr/bin/docker image inspect --format '{{.Id}}' "$ARCHIVE_TAG")
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
# The LaTeX archive is part of the same private release snapshot. Loading the
# uploaded file directly would permit it to change after root's validation.
bounded load-latex /usr/bin/docker load -i "$STAGE/latex-image.tar.gz"
LATEX_IMAGE=$(bounded resolve-latex /usr/bin/docker image inspect --format '{{.Id}}' "publisle-pdf-worker:$RELEASE_SHA")
[[ "$LATEX_IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]]
rm -f "$STAGE/image.tar.gz" "$STAGE/latex-image.tar.gz"
# Validators live in the isolated staging tree, not the production API install.
bounded dependencies /usr/bin/env -C "$STAGE/source/deploy/vps/qa" /usr/bin/npm ci --ignore-scripts --no-audit --no-fund
ln -s deploy/vps/qa/node_modules "$STAGE/source/node_modules"
bounded validator /usr/bin/node tools/install-verapdf.mjs "$VALIDATION/verapdf"
bounded verify /usr/bin/node deploy/vps/verify-release.mjs "$IMAGE" "$VALIDATION"
BACKUP=$(mktemp -d "/opt/publisle-api/rollback-$RELEASE_SHA.XXXXXX")
cp -a /etc/publisle-api.env "$BACKUP/env"
if [[ -e /etc/publisle-deployed-release ]]; then cp -a /etc/publisle-deployed-release "$BACKUP/source"; fi
if [[ -e /etc/publisle-native-pdf-verified.json ]]; then cp -a /etc/publisle-native-pdf-verified.json "$BACKUP/verification.json"; fi
FILES=(server.mjs images.mjs limits.mjs queue.mjs reap.mjs worker.mjs)
for file in "${FILES[@]}"; do [[ ! -e /opt/publisle-api/$file ]] || cp -a "/opt/publisle-api/$file" "$BACKUP/$file"; done
function rollback() {
  trap - ERR HUP INT TERM
  if [[ -e "$BACKUP/source" ]]; then cp -a "$BACKUP/source" /etc/publisle-deployed-release; else rm -f /etc/publisle-deployed-release; fi
  cp -a "$BACKUP/env" /etc/publisle-api.env
  if [[ -e "$BACKUP/verification.json" ]]; then cp -a "$BACKUP/verification.json" /etc/publisle-native-pdf-verified.json; else rm -f /etc/publisle-native-pdf-verified.json; fi
  for file in "${FILES[@]}"; do if [[ -e "$BACKUP/$file" ]]; then cp -a "$BACKUP/$file" "/opt/publisle-api/$file"; else rm -f "/opt/publisle-api/$file"; fi; done
  systemctl restart publisle-api
  echo 'Deployment failed; previous API, image configuration and verification restored.' >&2
}
trap rollback ERR
trap 'rollback; exit 1' HUP INT TERM
for file in "${FILES[@]}"; do install -o root -g root -m 0644 "$STAGE/source/deploy/vps/$file" "/opt/publisle-api/$file"; done
# Read an unprivileged output through an opened descriptor without following
# links; root must not copy arbitrary host files selected by a staging process.
/usr/bin/node --input-type=module - "$VALIDATION/verification.json" "$IMAGE" "$UID_PUBLISLE" <<'JS'
import assert from 'node:assert/strict';
import {openSync,closeSync,fstatSync,readSync,writeFileSync,renameSync,constants} from 'node:fs';
const fd=openSync(process.argv[2],constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
let report;
try {
 const stat=fstatSync(fd);assert(stat.isFile()&&stat.uid===Number(process.argv[4])&&stat.nlink===1&&stat.size<=1024*1024);
 const bytes=Buffer.alloc(1024*1024+1);const count=readSync(fd,bytes,0,bytes.length,0);assert(count<=1024*1024);
 report=JSON.parse(bytes.subarray(0,count).toString('utf8'));
} finally {closeSync(fd);}
assert(report.image===process.argv[3]&&report.passed===true);
const path='/etc/publisle-native-pdf-verified.json';
writeFileSync(path+'.new',JSON.stringify(report,null,2)+'\n',{mode:0o644});renameSync(path+'.new',path);
JS
/usr/bin/node --input-type=module - "$IMAGE" <<'JS'
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const path='/etc/publisle-api.env';let text=readFileSync(path,'utf8');
for(const [key,value]of Object.entries({PDF_NATIVE_WORKER_IMAGE:process.argv[2],PDF_NATIVE_TEMPLATES:'article,article-arabic,ieee-journal,acm-journal,springer-journal,elsevier-numeric,elsevier-author-date',PDF_NATIVE_VERIFICATION_FILE:'/etc/publisle-native-pdf-verified.json'})){
 const line=new RegExp('^'+key+'=.*$','m');text=line.test(text)?text.replace(line,key+'='+value):text+'\n'+key+'='+value+'\n';
}writeFileSync(path+'.new',text,{mode:0o640});renameSync(path+'.new',path);
JS
systemctl restart publisle-api
for attempt in {1..20}; do
  if /usr/bin/node --input-type=module <<'JS'
const base='https://api.publisle.xyz';const health=await(await fetch(base+'/health')).json();if(!health.services?.pdf)process.exit(1);
const capabilities=await(await fetch(base+'/pdf/capabilities')).json();const rows=capabilities.templates??capabilities.pdf?.templates??[];
if(rows.length!==7||rows.some(row=>row.engines[0]==='rust'||!row.engines.includes('rust')))process.exit(1);
JS
  then
    bounded live /usr/bin/node deploy/vps/verify-live.mjs
    printf '%s\n' "$RELEASE_SHA" > /etc/publisle-deployed-release.new
    chmod 0644 /etc/publisle-deployed-release.new
    mv /etc/publisle-deployed-release.new /etc/publisle-deployed-release
    trap - ERR HUP INT TERM
    prune_rollbacks /opt/publisle-api "$BACKUP"
    echo "Deployed $RELEASE_SHA ($IMAGE), health, legacy defaults and public compilations verified."
    exit 0
  fi
  sleep 2
done
false
