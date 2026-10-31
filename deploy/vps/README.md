# Internal website PDF service on OVH

This backend serves only the Publisle website. It is **not published to npm**.
The internal workspace and image-runtime manifests are private; the release gate
excludes them. The website remains static on GitHub Pages.

## Architecture and limits

Caddy forwards HTTPS to a Node 24 API on `127.0.0.1:8787`. The API admits one job
at a time, with at most two waiting requests and fifteen attempts per IP per
ten minutes. Identical repeat requests answered from the PDF cache do not
consume the attempt quota. The dedicated rootless runtime and API share `publisle-pdf.slice`, capped
at **0.5 vCPU and 512 MiB total**, including all compiler containers. Swap is
forbidden. Existing VPS workloads stay outside this hierarchy.

Each job validates editor data, obtains referenced public images, decodes images
in an isolated worker, then compiles with the existing research source generator
and `latexmk` in a fresh worker. Separating decoding from TeX releases decoder
memory before compilation. Workers have no network, capabilities, writable root
filesystem, or runtime socket. Their scratch space is 128 MiB, process count 64,
and memory limit 448 MiB; the aggregate 512-MiB ceiling still applies.

Default budgets: 256 KiB JSON, 12 distinct images, 4 MiB per download, 16 MiB total
input/converted images, eight megapixels per image, 16 MiB final PDF, 30 seconds
waiting and 180 seconds processing. PNG/JPEG remain raster images; self-contained
SVG is converted without a browser. Inline Markdown images become adjacent
figures. Interactive blocks retain readable static fallbacks. Missing images,
metadata, glyphs and citations fail explicitly. Publisher layouts retain their
existing accessibility limitations; standard LuaLaTeX articles retain PDF/UA
source defaults. Validation is performed in QA, not on every public request.

There is no database, object storage, upload endpoint or persistent job record.
Temporary job files disappear after success, failure, cancellation or timeout.
A content-addressed cache (opt-in via `PDF_CACHE_DIR`) retains compiled PDFs for
identical repeat requests until their TTL or a size cap evicts them; see
[the cache section](#pdf-cache) for the trade-offs. Labeled orphan containers and
job directories are removed on service restart.
Worker logging is disabled so binary PDF output is not written into runtime logs.
The API records only timing and failure codes.

## Local development and acceptance

```sh
pnpm install --frozen-lockfile
pnpm --filter @publisle/pdf-service build
docker build -f deploy/vps/worker.Dockerfile -t publisle-pdf-worker:local .
pnpm test:pdf-service
```

Run the real browser regression, including all editor modes and publication URL
checks, using the immutable image ID:

```sh
export PDF_TEST_WORKER_IMAGE="$(docker image inspect publisle-pdf-worker:local --format '{{.Id}}')"
node --test deploy/vps/tests/website.test.mjs
```

For manual website testing:

```sh
export PDF_WORKER_IMAGE="$PDF_TEST_WORKER_IMAGE"
PDF_ENABLED=true PDF_LOCAL_QA=true PDF_ORIGINS=http://localhost:4321 node deploy/vps/server.mjs
# In a second terminal:
PUBLIC_PDF_ENABLED=true PUBLIC_API_URL=http://127.0.0.1:8787 pnpm --filter @publisle/www dev
```

`PDF_LOCAL_QA` bypasses production resource/verification checks only outside
`NODE_ENV=production`. Its API still binds to loopback. Keep the CORS origin exact.

Run the aggregate feasibility gate on Linux with systemd user services, cgroup v2,
Docker CLI and `dockerd-rootless.sh` installed:

```sh
node deploy/vps/budget-check.mjs
```

This creates a separate temporary rootless daemon and transient user slice,
leaving the existing Docker daemon untouched. Image installation precedes the
compilation budget. API, runtime, image conversion and compiler then share the
hard limits. It compiles representative papers with citations, equations, tables,
external SVG and Arabic, and writes PDFs plus `budget.json` under
`.local/pdf-service-qa/`. Generated daemon data is retained in
`node_modules/.cache/publisle-pdf-qa/` for debugging. The QA runner itself is also
inside the budget, making the measurement conservative. External image availability
can fail this live gate; review the reported failure before diagnosing capacity.

**Do not enable production PDF when this gate fails.** Do not raise limits,
substitute a lossy exporter or disable tagging automatically. Re-run after worker
changes: readiness requires a passing report for the exact installed image.

## Provisioning the shared VPS

Supported target: Debian/Ubuntu with systemd and cgroup v2. Install Docker Engine
CLI and rootless extras from the official Docker repository first. Do not replace
or stop an existing shared Docker daemon. Configure DNS for `api.publisle.xyz`
and ensure ports 80/443 are already allowed by the host/network firewall.

Copy `deploy/vps/` to the VPS and run `sudo bash install.sh`. The installer creates
a dedicated `publisle` account/runtime, installs the aggregate resource hierarchy,
and starts the API with PDF disabled on first installation. It preserves existing
firewall rules and Caddy hosts. Existing API host configuration requires manual
review against the supplied Caddyfile. It restarts only the dedicated Publisle
user manager and API during updates. A rootless runtime must have delegated CPU,
memory and PID controllers; readiness fails if the required hierarchy is absent.

Build the worker on a development/build host, then transfer it with `docker save`
and load it into **publisle's rootless daemon**, using its
`DOCKER_HOST=unix:///run/user/<publisle-uid>/docker.sock`. Runtime requests never
build or pull images. Keep the previous image ID and verification report for rollback.

After all local acceptance and PDF/UA checks pass, install the reviewed matching
`budget.json` as `/etc/publisle-pdf-verified.json` (root-owned, mode 0644). Set these
in `/etc/publisle-api.env`:

```text
PDF_ENABLED=true
PDF_WORKER_IMAGE=sha256:<immutable-installed-image-id>
PDF_ORIGINS=https://publisle.xyz
PDF_ASSET_BASE=https://publisle.xyz/
PDF_CACHE_DIR=/var/lib/publisle-pdf/cache
```

This is the manual first installation. Later CI releases rewrite `PDF_WORKER_IMAGE`,
`PDF_NATIVE_WORKER_IMAGE` and both verification reports together; see
[CI deploy access](#ci-deploy-access).

## PDF cache

Without `PDF_CACHE_DIR` every compile runs the full container pipeline, so an
identical repeat export pays the full compilation time again. With the cache
enabled, a request whose validated JSON (document/markdown, template, engine,
style, data) and worker image hash to an already-stored key is served from disk
and reports a `pdf-cache-hit` diagnostic. Two properties matter for freshness:

- Documents may reference remote figure assets. A cached PDF is only as fresh
  as its TTL, which is why the cache is opt-in and entries expire quickly by
  default (`PDF_CACHE_TTL_MS`, one hour).
- Total cache size is capped at 256 MiB; the oldest entries are evicted first.

The cache lives under the service's `StateDirectory`, so it survives restarts
but not a reprovision. Set `PDF_CACHE_DIR=/var/lib/publisle-pdf/cache` (the
installer's template value) or disable it by leaving the variable unset.

When the public edge is another reverse proxy that cannot reach loopback (for
example a Dockerized nginx), also set `PDF_BIND` to an RFC1918 address on this
host, such as the Docker bridge gateway, and declare that proxy in
`PDF_TRUST_PROXY` (comma-separated IPs or IPv4 CIDRs). The API then serves on
`PDF_BIND` instead of loopback and derives the client identity for its
per-IP admission limits from the rightmost untrusted `X-Forwarded-For` entry.
Forward the original visitor address (`proxy_set_header X-Forwarded-For
$proxy_add_x_forwarded_for;`), keep body caps at 256 KiB and response timeouts
at or above 220 seconds, and never expose `PDF_BIND` to the public internet.
The installer skips Caddy when 80/443 already serve a non-Caddy edge; integrate
the API host into that proxy manually. [nginx-api-errors.conf](nginx-api-errors.conf)
holds `client_max_body_size 256k`, `proxy_read_timeout 220s`,
`proxy_intercept_errors on`, and JSON `error_page` bodies for 413 and
502/503/504. Those locations set `Access-Control-Allow-Origin`,
`Access-Control-Expose-Headers`, and `Vary` with nginx's `always` flag so the
browser can read an edge error. [nginx-api.conf.example](nginx-api.conf.example)
shows the surrounding server block. Do not copy the example over a live site: it
has no certificates. Install the snippet once as
`/etc/nginx/snippets/publisle-api-errors.conf`, add
`include /etc/nginx/snippets/publisle-api-errors.conf;` inside the existing
`api.publisle.xyz` TLS server, then `nginx -t` and reload. The edge accepts a
request only up to 256 KiB, so a larger POST gets that JSON 413 rather than nginx's
HTML page, which a browser cannot read cross-origin. After that, the host sync
replaces the snippet. Successful activation also keeps only the
newest three `/opt/publisle-api/rollback-*` directories and never deletes the
snapshot taken for that activation.

## CI deploy access

CI reaches this host with two keys that can each run only fixed commands. Neither
is a login. Install these root-owned, once, before the first release that uses them:

| File on the server                   | Source in `deploy/vps/` | Mode |
| ------------------------------------ | ----------------------- | ---- |
| `/usr/local/sbin/publisle-deploy`    | `activate-release.sh`   | 0755 |
| `/usr/local/bin/publisle-receive`    | `publisle-receive`      | 0755 |
| `/usr/local/sbin/publisle-host-sync` | `publisle-host-sync`    | 0755 |

`/etc/publisle-deploy.conf` (root-owned, not writable by others) is sourced by root:

```text
PUBLISLE_REPO=<owner>/<repo>
# Optional. Defaults are for a host-installed nginx; set them for a container.
# NGINX_SNIPPET=/etc/nginx/snippets/publisle-api-errors.conf
# NGINX_TEST_CMD="nginx -t"
# NGINX_RELOAD_CMD="systemctl reload nginx"
```

For a private repository, put a read-only token in `/etc/publisle-deploy-github-token`
(root-only, mode 0600). `sudoers` grants each account exactly one program:

```text
deploy    ALL=(root) NOPASSWD: /usr/local/sbin/publisle-deploy
hostsync  ALL=(root) NOPASSWD: /usr/local/sbin/publisle-host-sync
```

`authorized_keys` pins each key to its program. `restrict` disables forwarding,
agents and terminals:

```text
# deploy user (automatic production environment)
restrict,command="/usr/local/bin/publisle-receive" ssh-ed25519 AAAA... ci-deploy
# hostsync user (production-host environment, requires a reviewer)
restrict,command="/usr/local/sbin/publisle-host-sync" ssh-ed25519 AAAA... ci-host-sync
```

Cut over in this order, before merging a release that ships the new `release.sh`.
The old key is a shell, and the new script sends it `status`, which a shell does
not understand:

1. Install the three files and the config above, and add the sudoers lines.
2. Install the nginx snippet and its `include`, as described above.
3. Restrict the deploy key's `authorized_keys` line, then create the host-sync user and key.
4. Run the **Host policy sync** workflow once to confirm that the host key, the
   fetch from GitHub and the 413 probe all work.

Activation does not trust the SSH client. Besides the commit being on `main`, it
verifies the three uploaded archives against the `publisle-pdf-release` commit
status that the release job wrote with its own token, and it loads images only
from that verified snapshot. A stolen deploy key can therefore stage bytes but
not make the server accept bytes the release job did not build.

Preserve the installer's `HOME`, `XDG_RUNTIME_DIR` and `DOCKER_HOST` values.
Restart `publisle-api` and verify `/health` reports `services.pdf=true`. Readiness
checks the report, image availability, rootless runtime, cgroup v2 and aggregate
limits. Check the live host's memory/CPU usage as well; local timing is not an OVH
performance guarantee. Caddy and the host OS are shared infrastructure outside
the PDF service slice.

Only then set the GitHub repository variable `PUBLIC_PDF_ENABLED=true`; optionally
set `PUBLIC_API_URL`. Build/deploy the site using its existing workflow. Roll back
immediately by disabling that variable and setting `PDF_ENABLED=false`, or restore
the previous image and its matching verification report.

## API contract

- `GET /health`: API liveness and PDF readiness.
- `GET /pdf/capabilities`: enablement, seven shipped layouts, engines, metadata and limits.
- `POST /pdf/compile`: JSON containing exactly one of `document` or `markdown`,
  optional `template` (default `article`), supported `engine`, and optional
  `data.country` for ACM. All templates require title and authors.

`Accept: application/pdf` returns a PDF attachment and bounded base64-encoded JSON
warnings in `X-Publisle-Diagnostics`. Clients without that accept header retain
`{ok:true,pdfBase64,diagnostics}` compatibility. Errors return `{ok:false,code,message}`;
`429` includes `Retry-After`. Compilation logs and internal paths are not returned.

Images require public HTTPS with no credentials or custom ports. The downloader
checks every resolved address and redirect and pins connections to validated IPs.
Relative references resolve against `PDF_ASSET_BASE`. SVG scripts, external file
references, CSS imports and external resources are rejected. The independent
bibliography-fetching API is not used by this public service.

## Native Rust candidate and rollout gate

The native worker uses a single sandbox session for preparation and compilation.
It waits for the API to stage validated assets, then produces a tagged PDF using
the exact registry-pinned Rust binary and fonts, installed during image construction
from the native runtime lockfile. Rust source compilation takes place in publisle-rs. Its image contains no TeX runtime. The existing
LaTeX worker remains available for source-compatible journal exports and rollback.
See [native compiler setup and limitations](https://github.com/publisle/publisle-rs/blob/main/crates/publisle-pdf/README.md).

```sh
pnpm --filter @publisle/pdf-service build
docker build -f deploy/vps/native-worker.Dockerfile -t publisle-pdf-native:local .
export PDF_TEST_NATIVE_WORKER_IMAGE="$(docker image inspect publisle-pdf-native:local --format '{{.Id}}')"
export PDF_TEST_VERAPDF=/absolute/path/to/verapdf
node --test deploy/vps/tests/native.test.mjs
PDF_QA_IMAGE=publisle-pdf-native:local PDF_QA_BENCHMARK=true PDF_BENCH_RUST=true \
  PDF_BENCH_SAMPLES=30 PDF_BENCH_WARMUPS=5 node deploy/vps/budget-check.mjs
```

Configure `PDF_NATIVE_WORKER_IMAGE` with an immutable local image ID,
`PDF_NATIVE_TEMPLATES` with a comma-separated list of independently verified
profile IDs, and `PDF_NATIVE_VERIFICATION_FILE` with its verification record.
Without all three and a passing readiness check the API advertises only the
existing engines. Do not reuse the legacy image's verification record.

The record retains `image`, `passed`, `aggregateCpu: 0.5`,
`aggregateMemoryMiB: 512` and successful `samples` for each enabled profile
(`template`, `engine: "rust"`, `pdfBytes`). It additionally requires
`native.templates` entries with `id`, `contentParity`, `layoutChecksPassed`,
`pdfUa2`, `uncachedSamples` (at least 30) and `uncachedP95Ms` (below 5000).
The deployment gate also checks extracted text, glyphs and text bounds, and retains rendered pages for review.
Once verified, Rust is available as an explicit choice for those profiles. The existing legacy
engine requests continue to work. Changing the image requires fresh evidence.
Rollback removes the native environment settings and restarts the API; retain
the previous image and its verification file.
