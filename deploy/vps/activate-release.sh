#!/usr/bin/env bash
# Install this root-owned as /usr/local/sbin/publisle-deploy. Grant the dedicated
# deploy user sudo access to this entry point only, never to arbitrary scripts.
# The deploy key reaches it only through publisle-receive (a forced command):
#   publisle-deploy stage <sha>     read the release bundle from stdin
#   publisle-deploy activate <sha>  verify provenance, then activate the staged release
#   publisle-deploy cleanup <sha>   remove that release's staged bytes
set -euo pipefail
umask 077
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
# BEGIN safe_tar
# Validate an archive before root extracts it. $1 is the archive and $2 is a
# regular expression every member name must match. Only regular files and
# directories are allowed. Absolute names, ".." components, links and any name
# that tar must escape (control characters, backslashes, non-ASCII) are refused.
safe_tar_check() {
  local archive=$1 pattern=$2 count=0 kind name
  local -a kinds=() names=()
  while IFS= read -r kind; do kinds+=("${kind:0:1}"); done < <(LC_ALL=C tar --quoting-style=escape -tvf "$archive")
  while IFS= read -r name; do names+=("$name"); done < <(LC_ALL=C tar --quoting-style=escape -tf "$archive")
  (( ${#names[@]} > 0 && ${#names[@]} == ${#kinds[@]} && ${#names[@]} <= 100000 )) || return 1
  for name in "${names[@]}"; do
    kind=${kinds[$count]}
    count=$((count + 1))
    [[ $kind == - || $kind == d ]] || return 1
    [[ $name != /* && $name != *\\* && $name != .. && $name != ../* && $name != */../* && $name != */.. ]] || return 1
    [[ $name =~ $pattern ]] || return 1
  done
}
# Extract into a directory that already exists and is empty.
safe_tar_extract() {
  safe_tar_check "$1" "$2"
  [[ -d $3 && ! -L $3 && -z $(find "$3" -mindepth 1 -print -quit) ]]
  tar -xf "$1" -C "$3" --no-same-owner --no-same-permissions --no-overwrite-dir
}
# END safe_tar
[[ $EUID -eq 0 && $# -eq 2 && ${1:-} =~ ^(stage|activate|cleanup)$ && ${2:-} =~ ^[a-f0-9]{40}$ ]]
ACTION=$1
RELEASE_SHA=$2
RELEASES=/var/lib/publisle-releases
INCOMING_ROOT="$RELEASES/incoming"
INCOMING="$INCOMING_ROOT/$RELEASE_SHA"
# Stage and activation share one lock so a second push cannot interleave.
exec 9>/run/publisle-deploy.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
install -d -o root -g root -m 0755 "$RELEASES"
# Staged bytes live where only root can write or open them. The deploy user can
# stream a bundle in, but cannot touch it between stage and activate.
install -d -o root -g root -m 0700 "$INCOMING_ROOT"
# The upload lands beside the extraction directory, never inside it: extraction
# requires an empty directory.
BUNDLE="$INCOMING_ROOT/$RELEASE_SHA.bundle"
if [[ $ACTION == cleanup ]]; then
  rm -rf -- "$INCOMING" "$BUNDLE"
  exit 0
fi
if [[ $ACTION == stage ]]; then
  # Bundle members are fixed names, so no member can name another path.
  STAGE_MAX_BYTES=$((4 * 1024 * 1024 * 1024))
  find "$INCOMING_ROOT" -mindepth 1 -maxdepth 1 -mtime +1 -exec rm -rf -- {} +
  rm -rf -- "$INCOMING" "$BUNDLE"
  install -d -o root -g root -m 0700 "$INCOMING"
  trap 'rm -rf -- "$INCOMING" "$BUNDLE"' ERR HUP INT TERM
  head -c $((STAGE_MAX_BYTES + 1)) > "$BUNDLE"
  (( $(stat -c %s "$BUNDLE") <= STAGE_MAX_BYTES ))
  safe_tar_extract "$BUNDLE" '^(image\.tar\.gz|latex-image\.tar\.gz|source\.tar)$' "$INCOMING"
  rm -f -- "$BUNDLE"
  for member in image.tar.gz latex-image.tar.gz source.tar; do
    [[ -f "$INCOMING/$member" && ! -L "$INCOMING/$member" ]]
  done
  trap - ERR HUP INT TERM
  echo "Staged $RELEASE_SHA."
  exit 0
fi

# ACTION is activate. Nothing below trusts a value supplied by the SSH client
# other than the SHA, and that SHA must pass the provenance checks.
[[ -d "$INCOMING" && ! -L "$INCOMING" && $(stat -c %u:%a "$INCOMING") == 0:700 ]]
CONFIG=/etc/publisle-deploy.conf
# Root-owned, regular, and not writable by group or others: it is sourced as root.
[[ -f $CONFIG && ! -L $CONFIG && $(stat -c '%u %a' "$CONFIG") =~ ^0\ [0-7][0145][0145]$ ]]
# shellcheck disable=SC1090
source "$CONFIG"
[[ ${PUBLISLE_REPO:-} =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Set PUBLISLE_REPO=<owner>/<repo> in $CONFIG." >&2; exit 1; }
command -v java >/dev/null
command -v pdftotext >/dev/null
# Snapshot into a root-owned private copy and validate that copy. A failure before
# validation removes it; later failures keep the reports for debugging.
STAGE=$(mktemp -d "$RELEASES/$RELEASE_SHA.XXXXXX")
trap 'rm -rf -- "$STAGE"' ERR
cp --no-dereference "$INCOMING/image.tar.gz" "$INCOMING/latex-image.tar.gz" "$INCOMING/source.tar" "$STAGE/"
rm -rf -- "$INCOMING"
# BEGIN provenance
# The release job records one digest over exactly the three uploaded archives as
# a GitHub commit status written with its own GITHUB_TOKEN. The SSH key cannot
# write statuses, and the activator trusts no digest from the SSH client.
github_get() {
  local url=$1 output=$2
  if [[ -f /etc/publisle-deploy-github-token ]]; then
    printf 'header = "Authorization: Bearer %s"\n' "$(< /etc/publisle-deploy-github-token)" |
      curl -fsS --proto '=https' --max-time 30 -H 'Accept: application/vnd.github+json' -K - -o "$output" "$url"
  else
    curl -fsS --proto '=https' --max-time 30 -H 'Accept: application/vnd.github+json' -o "$output" "$url"
  fi
}
PROVENANCE_COMPARE="$STAGE/provenance-compare.json"
PROVENANCE_STATUSES="$STAGE/provenance-statuses.json"
github_get "https://api.github.com/repos/$PUBLISLE_REPO/compare/main...$RELEASE_SHA?per_page=1" "$PROVENANCE_COMPARE"
github_get "https://api.github.com/repos/$PUBLISLE_REPO/commits/$RELEASE_SHA/statuses?per_page=100" "$PROVENANCE_STATUSES"
IMAGE_ARCHIVE_SHA=$(sha256sum "$STAGE/image.tar.gz" | cut -d' ' -f1)
LATEX_ARCHIVE_SHA=$(sha256sum "$STAGE/latex-image.tar.gz" | cut -d' ' -f1)
SOURCE_ARCHIVE_SHA=$(sha256sum "$STAGE/source.tar" | cut -d' ' -f1)
/usr/bin/node --input-type=module - "$PROVENANCE_COMPARE" "$PROVENANCE_STATUSES" "$IMAGE_ARCHIVE_SHA" "$LATEX_ARCHIVE_SHA" "$SOURCE_ARCHIVE_SHA" <<'JS'
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const [compareFile,statusFile,image,latex,source]=process.argv.slice(2);
const compare=JSON.parse(readFileSync(compareFile,'utf8'));
// "behind" or "identical" against main means the release commit is on main.
assert(['behind','identical'].includes(compare.status), 'The release commit is not on main');
const statuses=JSON.parse(readFileSync(statusFile,'utf8'));
assert(Array.isArray(statuses));
const record=statuses.find((entry)=>entry?.context==='publisle-pdf-release');
assert(record, 'No release record exists for this commit');
assert(record.state==='success'&&record.creator?.login==='github-actions[bot]'&&record.creator?.type==='Bot', 'The release record was not written by the release job');
const digest=createHash('sha256').update(`image=${image}\nlatex=${latex}\nsource=${source}\n`).digest('hex');
assert(record.description===`publisle-pdf-release sha256:${digest}`, 'The staged archives differ from the release record');
JS
# END provenance
mkdir "$STAGE/unpack"
safe_tar_extract "$STAGE/source.tar" '^source(/.*)?$' "$STAGE/unpack"
mv "$STAGE/unpack/source" "$STAGE/source"
rmdir "$STAGE/unpack"
rm -f "$STAGE/source.tar" "$PROVENANCE_COMPARE" "$PROVENANCE_STATUSES"
[[ -d "$STAGE/source/deploy/vps" && -z $(find "$STAGE" ! -type f ! -type d -print -quit) ]]
trap - ERR
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
# archive's own configuration, then resolve the immutable ID on this daemon.
# The archive bytes already matched the release record above.
METADATA=$(bounded metadata /usr/bin/tar -xzOf "$STAGE/image.tar.gz" manifest.json)
IMAGE=$(/usr/bin/node --input-type=module - "$METADATA" <<'JS'
import assert from 'node:assert/strict';
const entries=JSON.parse(process.argv[2]);
assert(entries.length===1);
const config=/^(?:blobs\/sha256\/([a-f0-9]{64})|([a-f0-9]{64})\.json)$/.exec(entries[0].Config);
assert(config);
console.log(`sha256:${config[1]??config[2]}`);
JS
)
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
bounded verify /usr/bin/node deploy/vps/verify-release.mjs "$IMAGE" "$VALIDATION" "$LATEX_IMAGE"
BACKUP=$(mktemp -d "/opt/publisle-api/rollback-$RELEASE_SHA.XXXXXX")
cp -a /etc/publisle-api.env "$BACKUP/env"
if [[ -e /etc/publisle-deployed-release ]]; then cp -a /etc/publisle-deployed-release "$BACKUP/source"; fi
if [[ -e /etc/publisle-native-pdf-verified.json ]]; then cp -a /etc/publisle-native-pdf-verified.json "$BACKUP/verification.json"; fi
if [[ -e /etc/publisle-pdf-verified.json ]]; then cp -a /etc/publisle-pdf-verified.json "$BACKUP/verification-latex.json"; fi
FILES=(server.mjs images.mjs limits.mjs queue.mjs reap.mjs worker.mjs)
for file in "${FILES[@]}"; do [[ ! -e /opt/publisle-api/$file ]] || cp -a "/opt/publisle-api/$file" "$BACKUP/$file"; done
function rollback() {
  trap - ERR HUP INT TERM
  if [[ -e "$BACKUP/source" ]]; then cp -a "$BACKUP/source" /etc/publisle-deployed-release; else rm -f /etc/publisle-deployed-release; fi
  cp -a "$BACKUP/env" /etc/publisle-api.env
  if [[ -e "$BACKUP/verification.json" ]]; then cp -a "$BACKUP/verification.json" /etc/publisle-native-pdf-verified.json; else rm -f /etc/publisle-native-pdf-verified.json; fi
  if [[ -e "$BACKUP/verification-latex.json" ]]; then cp -a "$BACKUP/verification-latex.json" /etc/publisle-pdf-verified.json; else rm -f /etc/publisle-pdf-verified.json; fi
  for file in "${FILES[@]}"; do if [[ -e "$BACKUP/$file" ]]; then cp -a "$BACKUP/$file" "/opt/publisle-api/$file"; else rm -f "/opt/publisle-api/$file"; fi; done
  systemctl restart publisle-api
  echo 'Deployment failed; previous API, image configuration and verification restored.' >&2
}
trap rollback ERR
trap 'rollback; exit 1' HUP INT TERM
for file in "${FILES[@]}"; do install -o root -g root -m 0644 "$STAGE/source/deploy/vps/$file" "/opt/publisle-api/$file"; done
# BEGIN install_report
# Read an unprivileged output through an opened descriptor without following
# links; root must not copy arbitrary host files selected by a staging process.
install_report() {
/usr/bin/node --input-type=module - "$1" "$2" "$UID_PUBLISLE" "$3" <<'JS'
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
const path=process.argv[5];
assert(path==='/etc/publisle-native-pdf-verified.json'||path==='/etc/publisle-pdf-verified.json');
writeFileSync(path+'.new',JSON.stringify(report,null,2)+'\n',{mode:0o644});renameSync(path+'.new',path);
JS
}
# END install_report
install_report "$VALIDATION/verification.json" "$IMAGE" /etc/publisle-native-pdf-verified.json
# The LaTeX report is what lets the API accept the new PDF_WORKER_IMAGE.
install_report "$VALIDATION/verification-latex.json" "$LATEX_IMAGE" /etc/publisle-pdf-verified.json
/usr/bin/node --input-type=module - "$IMAGE" "$LATEX_IMAGE" <<'JS'
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
const path='/etc/publisle-api.env';let text=readFileSync(path,'utf8');
for(const [key,value]of Object.entries({PDF_NATIVE_WORKER_IMAGE:process.argv[2],PDF_NATIVE_TEMPLATES:'article,article-arabic,ieee-journal,acm-journal,springer-journal,elsevier-numeric,elsevier-author-date',PDF_NATIVE_VERIFICATION_FILE:'/etc/publisle-native-pdf-verified.json',PDF_WORKER_IMAGE:process.argv[3],PDF_VERIFICATION_FILE:'/etc/publisle-pdf-verified.json'})){
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
    echo "Deployed $RELEASE_SHA (native $IMAGE, LaTeX $LATEX_IMAGE), health, legacy defaults and public compilations verified."
    exit 0
  fi
  sleep 2
done
false
