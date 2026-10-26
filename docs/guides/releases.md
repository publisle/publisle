# Releases

Public packages use Changesets and npm trusted publishing. They have independent
versions. Research pins an exact external native compiler version published from
[publisle-rs](https://github.com/publisle/publisle-rs). Contract versions and the legacy compiler recipe remain separate.

## Ship a change

1. Run `pnpm changeset` for public package changes. Describe the user-visible change;
   use a minor bump for breaking changes during `0.x`. Documentation and private
   workflow changes do not need a Changeset.
2. Merge the implementation PR after required checks pass. The Release workflow
   opens or updates **Version packages** with versions, changelogs and lockfile.
3. Merge **Version packages** after its checks pass. Release promotes its exact
   tested tarballs, publishes through OIDC with provenance, verifies registry
   integrity, and creates a GitHub release for each `@publisle/package@version`.
4. The PDF deployment runs automatically after publication checks. It validates
   the candidate within 0.5 CPU / 512 MiB with no swap, checks health and engine
   defaults, and restores the previous API configuration on failure.

The activation entry point snapshots and loads both native and LaTeX worker
archives from the same release. Reinstall the reviewed root-owned
`deploy/vps/activate-release.sh` when that entry point changes. LaTeX activation
still requires its matching resource-budget verification report and operator
image pin; staging an image alone does not update the live LaTeX worker.

PR checks cover packed declarations, dependency ranges, isolated Core and Research
consumers, the Fourier showcase, and Research installs on Linux, macOS and Windows.
The Rust repository builds and smoke-tests all five native platforms. The version PR
must be current with main: publication rejects artifacts from a different source
tree. Release does not rebuild packages after publication starts.

Ordinary numeric versions use `latest`. Actual prereleases use `next`; use
Changesets prerelease mode to prepare them. The old `beta` tag is retired.

## Recover an interrupted release

Use **Re-run failed jobs** on the original Release run. Its retained archives and
upload record are the source of truth. The publisher checks every existing
version before uploading, skips versions with matching SHA-512 integrity, and
rejects immutable version collisions before publishing anything.

npm can accept a tarball before making it visible. A visibility `404` or an
`E409` for a previously staged version means wait and verify; it is not a reason
to rebuild or submit another tarball. Accepted uploads are recorded and polling
is bounded. If processing outlasts the job, rerun it after npm catches up.
GitHub releases are reconciled on reruns, including releases missing after all
packages were published. SHA-512 `dist.integrity` and downloaded bytes establish
identity; legacy `dist.shasum` is not used.

Publication is irreversible. A failed deployment restores production configuration
and reports failure; it does not remove npm versions. Keep the previous image
and verification record until the new deployment is confirmed healthy.

## One-time setup

All 24 TypeScript packages must trust `publisle/publisle`, workflow **release.yml**, with
publishing allowed and no npm environment restriction. Use a browser-authenticated
npm 12.2 account with package administration rights:

```sh
node tools/npm-trusted-publishers.ts
node tools/npm-trusted-publishers.ts --apply
```

The preview lists the full package inventory. Applying skips matching entries and
stops on failure. npm can require browser 2FA; its five-minute approval window
allows the batch. Tokens that bypass 2FA cannot change account settings. A brand
new package needs an initial approved publication before npm accepts its trusted
publisher configuration. Complete that bootstrap before enabling its release.

GitHub Actions needs permission to create PRs and push the version branch. The
workflow explicitly dispatches validation because PRs created with `GITHUB_TOKEN`
do not trigger ordinary PR workflows.

For production, configure `PDF_DEPLOY_HOST`, `PDF_DEPLOY_USER` and the pinned
`PDF_DEPLOY_HOST_KEY` as production environment variables, and `PDF_DEPLOY_KEY` as
its dedicated SSH secret. Install `deploy/vps/activate-release.sh` root-owned as
`/usr/local/sbin/publisle-deploy`; the deployment account may sudo only this entry
point. The production environment uses automatic checks without required human
reviewers. Never reuse a personal SSH private key for CI.

The VPS must already have the dedicated Publisle rootless Docker runtime, cgroup
limits, Node.js 24, Java, Poppler and service configuration described in the
[deployment guide](../../deploy/vps/README.md). Runtime requests never build or
pull images, install compilers, or require Python.

## Native engine releases

Rust engine development, conformance pins and native npm releases live in
[publisle-rs](https://github.com/publisle/publisle-rs). Its `release.yml` publishes
crates with release-plz and the five `@publisle/pdf-native-*` packages. Those five
npm publishers trust `publisle/publisle-rs`, workflow `release.yml`, with no environment.
The TypeScript trusted-publisher helper covers only this repository's 24 packages.

Research's optional dependencies pin one exact native version independently from
its own version. Dependabot groups updates to all five pins and the VPS native
runtime lockfile in one weekly PR. Review it, add a Research patch Changeset, and
verify all three consumer platforms before merging Version packages. Runtime
compilation never downloads or builds a compiler.

The VPS secrets, worker integration and deployment remain in this repository.
The worker's build stage runs `npm ci` against
`deploy/vps/native-runtime/package-lock.json`, verifies the package inventory,
and copies the pinned executable and fonts into its final runtime. Deployment
compares the binary with the published native package using the pinned native
version, independently of the Research package version.
