import { test } from "node:test";
import assert from "node:assert/strict";
import { assertCompliant } from "../validate-pdf-ua.mjs";
import { platformDigest } from "../compiler-platform-digest.mjs";
import { releaseRecord } from "../compiler-release-record.mjs";
import { installerJar } from "../install-verapdf.mjs";
const valid =
  '<report><jobs><job><validationReport jobEndStatus="normal" profileName="PDF/UA-2 + Tagged PDF validation profile" isCompliant="true"><details failedRules="0" failedChecks="0"/></validationReport></job></jobs><batchSummary totalJobs="1" failedToParse="0" encrypted="0" outOfMemory="0" veraExceptions="0"><validationReports compliant="1" nonCompliant="0" failedJobs="0">1</validationReports></batchSummary></report>';
test("requires one complete, matching, successful veraPDF job", () => {
  assertCompliant(valid);
  assertCompliant(valid.replace("PDF/UA-2 + Tagged PDF", "PDF/UA-1"), "ua1");
  const invalid = [
    "not XML",
    "<report/>",
    valid.replace("PDF/UA-2", "PDF/A-2B"),
    valid.replace('isCompliant="true"', 'isCompliant="false"'),
    valid.replace('jobEndStatus="normal"', 'jobEndStatus="aborted"'),
    valid.replace('jobEndStatus="normal"', ""),
    valid.replace("</job>", "</job><job/>"),
    valid.replace('failedRules="0"', 'failedRules="1"'),
    valid.replace('failedChecks="0"', 'failedChecks="1"'),
    valid.replace('totalJobs="1"', 'totalJobs="0"'),
    valid.replace('failedToParse="0"', 'failedToParse="1"'),
    valid.replace('veraExceptions="0"', 'veraExceptions="1"'),
    valid.replace('failedJobs="0"', 'failedJobs="1"'),
    valid.replace('nonCompliant="0"', 'nonCompliant="1"'),
    valid.replace('<details failedRules="0" failedChecks="0"/>', ""),
    valid.replace(
      "</job>",
      '</job><job><validationReport isCompliant="true"/></job>',
    ),
    '<!DOCTYPE report [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + valid,
    valid + "<report/>",
    valid.replace("</report>", ""),
    valid.replace("</jobs>", "</jobs><jobs/>"),
  ];
  for (const report of invalid)
    assert.throws(() => assertCompliant(report), report);
});
const a = `sha256:${"a".repeat(64)}`;
const b = `sha256:${"b".repeat(64)}`;
const c = `sha256:${"c".repeat(64)}`;
const platforms = [
  { platform: { os: "linux", architecture: "amd64" }, digest: a },
  { platform: { os: "linux", architecture: "arm64" }, digest: b },
];
test("extracts a leaf digest without trusting extra OCI index platforms", () => {
  assert.equal(platformDigest({ digest: b }, "arm64"), b);
  assert.equal(
    platformDigest(
      {
        manifests: [
          ...platforms,
          { platform: { os: "unknown", architecture: "unknown" }, digest: c },
        ],
      },
      "arm64",
    ),
    b,
  );
  for (const manifest of [
    { manifests: [] },
    { manifests: [platforms[1], platforms[1]] },
    { digest: "sha256:no" },
  ])
    assert.throws(() => platformDigest(manifest, "arm64"));
  assert.throws(() => platformDigest({ digest: a }, "riscv64"));
});
test("release records retain and validate both actual platform digests", () => {
  const record = releaseRecord(
    "ghcr.io/voidreg/publisle-compiler",
    c,
    a,
    b,
    { manifests: platforms },
    { recipeVersion: 2 },
  );
  assert.equal(record.publishedImage, `ghcr.io/voidreg/publisle-compiler@${c}`);
  assert.equal(record.platforms["linux/arm64"], b);
  assert.equal(record.veraPdf.version, "1.28.2");
  for (const entries of [
    platforms.slice(0, 1),
    [platforms[1], platforms[1]],
    [...platforms, platforms[0]],
    [platforms[0], { ...platforms[1], digest: c }],
  ])
    assert.throws(() =>
      releaseRecord(
        "ghcr.io/voidreg/publisle-compiler",
        c,
        a,
        b,
        { manifests: entries },
        { recipeVersion: 2 },
      ),
    );
});
test("installer rejects untrusted bytes before ZIP extraction or execution", () => {
  assert.throws(
    () => installerJar(Buffer.from("not the pinned installer")),
    /checksum mismatch/,
  );
});

test(
  "deployment reads bounded regular verification files without following links",
  { skip: process.platform === "win32" },
  async () => {
    const { readFile, mkdtemp, writeFile, symlink, link, rm } =
      await import("node:fs/promises");
    const { execFileSync, spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const source = await readFile(
      new URL("../../deploy/vps/activate-release.sh", import.meta.url),
      "utf8",
    );
    const block = source.match(
      /"\$1" "\$2" "\$UID_PUBLISLE" "\$3" <<'JS'\n([\s\S]*?)\nJS/u,
    )?.[1];
    assert(block, "Privileged report reader is present");
    // Execute the production reader up to its privileged write, in a subprocess.
    const script = block.split("const path=process.argv[5]")[0];
    const directory = await mkdtemp(
      join(tmpdir(), "publisle-verification-test-"),
    );
    try {
      const file = join(directory, "record.json");
      await writeFile(file, JSON.stringify({ image: a, passed: true }));
      const read = (path, uid = process.getuid()) =>
        spawnSync(
          process.execPath,
          ["--input-type=module", "-", path, a, String(uid)],
          { input: script, encoding: "utf8", timeout: 5000 },
        );
      assert.equal(read(file).status, 0);
      assert.notEqual(read(file, process.getuid() + 1).status, 0);
      const symbolic = join(directory, "symbolic.json");
      await symlink(file, symbolic);
      assert.notEqual(read(symbolic).status, 0);
      const hard = join(directory, "hard.json");
      await link(file, hard);
      assert.notEqual(read(hard).status, 0);
      await rm(hard);
      const fifo = join(directory, "fifo");
      execFileSync("mkfifo", [fifo]);
      const result = read(fifo);
      assert.equal(result.error, undefined, "FIFO rejection must not block");
      assert.notEqual(result.status, 0);
      await writeFile(file, "x".repeat(1024 * 1024 + 1));
      assert.notEqual(read(file).status, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("binds Docker archive tags to the expected portable configuration digest", async () => {
  const { readFile } = await import("node:fs/promises");
  const { spawnSync } = await import("node:child_process");
  const source = await readFile(
    new URL("../../deploy/vps/activate-release.sh", import.meta.url),
    "utf8",
  );
  const script = source.match(
    /"\$METADATA" "\$IMAGE" "\$RELEASE_SHA" <<'JS'\n([\s\S]*?)\nJS/u,
  )?.[1];
  assert(script);
  const sha = "c".repeat(40);
  const inspect = (entries, expected = a) =>
    spawnSync(
      process.execPath,
      ["--input-type=module", "-", JSON.stringify(entries), expected, sha],
      {
        input: script,
        encoding: "utf8",
        timeout: 5000,
      },
    );
  for (const config of [`blobs/sha256/${a.slice(7)}`, `${a.slice(7)}.json`]) {
    for (const tag of [
      "publisle-pdf-release:latest",
      `publisle-pdf-release:${sha}`,
    ]) {
      const result = inspect([{ Config: config, RepoTags: [tag] }]);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout.trim(), tag);
      assert.notEqual(
        inspect([{ Config: config, RepoTags: [tag] }], b).status,
        0,
      );
    }
  }
  for (const entries of [
    [],
    [{ Config: `blobs/sha256/${a.slice(7)}`, RepoTags: ["unrelated:latest"] }],
    [
      {
        Config: `../../${a.slice(7)}.json`,
        RepoTags: ["publisle-pdf-release:latest"],
      },
    ],
  ])
    assert.notEqual(inspect(entries).status, 0);
});

async function activator() {
  const { readFile } = await import("node:fs/promises");
  return readFile(
    new URL("../../deploy/vps/activate-release.sh", import.meta.url),
    "utf8",
  );
}

test("activation points PDF_WORKER_IMAGE at the verified LaTeX image", async () => {
  const source = await activator();
  const writer = source.match(
    /"\$IMAGE" "\$LATEX_IMAGE" <<'JS'\n([\s\S]*?)\nJS/u,
  )?.[1];
  assert(writer, "Environment writer receives both image IDs");
  assert.match(writer, /PDF_NATIVE_WORKER_IMAGE:process\.argv\[2\]/u);
  assert.match(writer, /PDF_WORKER_IMAGE:process\.argv\[3\]/u);
  // server.mjs only enables an image that a matching report names, so the same
  // activation must install that report and keep it in the rollback snapshot.
  assert.match(
    source,
    /verification-latex\.json" "\$LATEX_IMAGE" \/etc\/publisle-pdf-verified\.json/u,
  );
  assert.match(
    source,
    /PDF_VERIFICATION_FILE:'\/etc\/publisle-pdf-verified\.json'/u,
  );
  assert.match(
    source,
    /cp -a \/etc\/publisle-pdf-verified\.json "\$BACKUP\/verification-latex\.json"/u,
  );
});

test("the LaTeX gate runs as its own lean process after the native gate", async () => {
  const source = await activator();
  const native = source.indexOf("deploy/vps/verify-release.mjs");
  const latex = source.indexOf("deploy/vps/verify-latex.mjs");
  assert(native > 0 && latex > native, "LaTeX gate follows the native gate");
  // The native harness peaks near 200 MiB; inside the 512 MiB slice with the API
  // and Docker that left no room for lualatex (kernel OOM, container exit 137).
  assert.doesNotMatch(
    source.slice(native, native + 120),
    /LATEX_IMAGE/u,
    "The native gate no longer carries the LaTeX image",
  );
  assert.match(
    source,
    /bounded verify-latex \/usr\/bin\/node --jitless --max-old-space-size=48 deploy\/vps\/verify-latex\.mjs "\$LATEX_IMAGE" "\$VALIDATION"/u,
  );
  const { readFile } = await import("node:fs/promises");
  const gate = await readFile(
    new URL("../../deploy/vps/verify-latex.mjs", import.meta.url),
    "utf8",
  );
  assert.match(gate, /verification-latex\.json/u);
  assert.match(gate, /OOM during LaTeX deployment validation/u);
  // One compile per template with its default engine, as the API readiness check
  // expects. Non-default engines (LuaLaTeX on ieee-journal) are at the edge of the
  // budget with the previous image too, so gating them would make deploys flaky.
  assert.match(gate, /const engine = template\.engines\[0\];/u);
  assert.doesNotMatch(gate, /of template\.engines\b/u);
  const nativeGate = await readFile(
    new URL("../../deploy/vps/verify-release.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(nativeGate, /latexImage|verification-latex/u);
});

test(
  "stage extracts the streamed release bundle and leaves no upload behind",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const { mkdtemp, writeFile, readdir, rm } =
      await import("node:fs/promises");
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const source = await activator();
    const functions = source.match(
      /# BEGIN safe_tar\n([\s\S]*?)# END safe_tar/u,
    )?.[1];
    const stage = source.match(
      /(# The upload lands beside[\s\S]*?\nif \[\[ \$ACTION == stage \]\]; then[\s\S]*?\n {2}exit 0\nfi)/u,
    )?.[1];
    assert(functions && stage, "The stage branch is present");
    const directory = await mkdtemp(join(tmpdir(), "publisle-stage-"));
    try {
      const sha = "a".repeat(40);
      for (const name of ["image.tar.gz", "latex-image.tar.gz", "source.tar"]) {
        await writeFile(join(directory, name), name);
      }
      assert.equal(
        spawnSync(
          "tar",
          [
            "-C",
            directory,
            "-cf",
            join(directory, "bundle.tar"),
            "image.tar.gz",
            "latex-image.tar.gz",
            "source.tar",
          ],
          { encoding: "utf8" },
        ).status,
        0,
      );
      // Only root ownership is stubbed; the stage logic itself runs unchanged.
      const script = [
        "set -euo pipefail",
        functions,
        'install() { local a=(); while (($#)); do case $1 in -o|-g) shift 2;; *) a+=("$1"); shift;; esac; done; command install "${a[@]}"; }',
        `INCOMING_ROOT="${join(directory, "incoming")}"`,
        `RELEASE_SHA=${sha}`,
        'INCOMING="$INCOMING_ROOT/$RELEASE_SHA"',
        "ACTION=stage",
        'install -d -m 0700 "$INCOMING_ROOT"',
        stage,
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], {
        encoding: "utf8",
        input: (await import("node:fs")).readFileSync(
          join(directory, "bundle.tar"),
        ),
      });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /Staged a{40}\./u);
      assert.deepEqual(
        (await readdir(join(directory, "incoming", sha))).sort(),
        ["image.tar.gz", "latex-image.tar.gz", "source.tar"],
      );
      assert.deepEqual(await readdir(join(directory, "incoming")), [sha]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("activation keeps a readable default umask and a private upload", async () => {
  const source = await activator();
  // A global umask 077 once masked the 0644 verification reports to 0600, which
  // the unprivileged API user could not read.
  assert.match(source, /^umask 022$/mu);
  assert.doesNotMatch(source, /^umask 077/mu);
  assert.match(source, /\(umask 077; head -c [^\n]*> "\$BUNDLE"\)/u);
});

test(
  "extracted source is readable and traversable but not writable by the service user",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const { mkdtemp, mkdir, writeFile, rm, stat } =
      await import("node:fs/promises");
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const source = await activator();
    const functions = source.match(
      /# BEGIN safe_tar\n([\s\S]*?)# END safe_tar/u,
    )?.[1];
    const permissions = source.match(
      /^chmod -R [^\n]* "\$STAGE\/source"$/mu,
    )?.[0];
    assert(functions && permissions, "The source permission step is present");
    const directory = await mkdtemp(join(tmpdir(), "publisle-source-mode-"));
    try {
      await mkdir(join(directory, "src/source/deploy/vps"), {
        recursive: true,
      });
      await writeFile(
        join(directory, "src/source/deploy/vps/verify-release.mjs"),
        "ok",
        { mode: 0o755 },
      );
      await writeFile(join(directory, "src/source/package.json"), "{}", {
        mode: 0o644,
      });
      const script = [
        "set -euo pipefail",
        "umask 077",
        functions,
        `STAGE="${join(directory, "stage")}"`,
        'mkdir "$STAGE" "$STAGE/unpack"',
        `tar -C "${join(directory, "src")}" -cf "$STAGE/source.tar" source`,
        'safe_tar_extract "$STAGE/source.tar" \'^source(/.*)?$\' "$STAGE/unpack"',
        'mv "$STAGE/unpack/source" "$STAGE/source"',
        permissions,
      ].join("\n");
      const result = spawnSync("bash", ["-c", script], { encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      const mode = async (path) =>
        (await stat(join(directory, "stage/source", path))).mode & 0o777;
      // Directories: group and others read and traverse, never write.
      assert.equal(await mode("."), 0o755);
      assert.equal(await mode("deploy/vps"), 0o755);
      // Files: readable by everyone, the executable bit is preserved, no writes.
      assert.equal(await mode("package.json"), 0o644);
      assert.equal(await mode("deploy/vps/verify-release.mjs"), 0o755);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  "root extraction refuses unsafe archives and accepts the release layout",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const { mkdtemp, writeFile, mkdir, rm, symlink, link, readFile } =
      await import("node:fs/promises");
    const { spawnSync } = await import("node:child_process");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const source = await activator();
    const functions = source.match(
      /# BEGIN safe_tar\n([\s\S]*?)# END safe_tar/u,
    )?.[1];
    assert(functions, "Archive validation is present");
    const directory = await mkdtemp(join(tmpdir(), "publisle-safe-tar-"));
    const run = (command, options = {}) =>
      spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        cwd: directory,
        ...options,
      });
    const attempt = (archive, pattern, extract = false) => {
      const destination = join(
        directory,
        `out-${Math.random().toString(36).slice(2)}`,
      );
      const script = `set -euo pipefail\n${functions}\nmkdir "$3"\n${extract ? 'safe_tar_extract "$1" "$2" "$3"' : 'safe_tar_check "$1" "$2"'}`;
      const result = spawnSync(
        "bash",
        ["-c", script, "bash", archive, pattern, destination],
        {
          encoding: "utf8",
        },
      );
      return { ...result, destination };
    };
    try {
      await mkdir(join(directory, "source/deploy/vps/[slug]"), {
        recursive: true,
      });
      await writeFile(
        join(directory, "source/deploy/vps/[slug]/+page.ts"),
        "ok",
      );
      assert.equal(run("tar -cf good.tar source").status, 0);
      const good = attempt(join(directory, "good.tar"), "^source(/.*)?$", true);
      assert.equal(good.status, 0, good.stderr);
      assert.equal(
        await readFile(
          join(good.destination, "source/deploy/vps/[slug]/+page.ts"),
          "utf8",
        ),
        "ok",
      );

      await symlink("/etc/passwd", join(directory, "source/escape"));
      run("tar -cf symlink.tar source");
      assert.notEqual(
        attempt(join(directory, "symlink.tar"), "^source(/.*)?$").status,
        0,
      );
      await rm(join(directory, "source/escape"));

      await link(
        join(directory, "source/deploy/vps/[slug]/+page.ts"),
        join(directory, "source/hard"),
      );
      run("tar -cf hardlink.tar source");
      assert.notEqual(
        attempt(join(directory, "hardlink.tar"), "^source(/.*)?$").status,
        0,
      );
      await rm(join(directory, "source/hard"));

      await writeFile(join(directory, "plain.txt"), "x");
      run(`tar -P -cf absolute.tar "${join(directory, "plain.txt")}"`);
      assert.notEqual(
        attempt(join(directory, "absolute.tar"), "^.*$").status,
        0,
      );
      run("tar -cf parent.tar --transform='s,^,../,' plain.txt");
      assert.notEqual(attempt(join(directory, "parent.tar"), "^.*$").status, 0);
      run("tar -cf nested.tar --transform='s,^,source/../../,' plain.txt");
      assert.notEqual(attempt(join(directory, "nested.tar"), "^.*$").status, 0);
      run("tar -cf outside.tar plain.txt");
      assert.notEqual(
        attempt(join(directory, "outside.tar"), "^source(/.*)?$").status,
        0,
      );
      await writeFile(join(directory, "back\\slash"), "x");
      run("tar -cf backslash.tar back\\\\slash");
      assert.notEqual(
        attempt(join(directory, "backslash.tar"), "^.*$").status,
        0,
      );
      await writeFile(join(directory, "new\nline"), "x");
      run("tar -cf newline.tar new*line");
      assert.notEqual(
        attempt(join(directory, "newline.tar"), "^.*$").status,
        0,
      );
      // The deployment bundle has three fixed members and nothing else.
      const bundle = "^(image\\.tar\\.gz|latex-image\\.tar\\.gz|source\\.tar)$";
      await writeFile(join(directory, "image.tar.gz"), "x");
      await writeFile(join(directory, "latex-image.tar.gz"), "x");
      await writeFile(join(directory, "source.tar"), "x");
      run("tar -cf bundle.tar image.tar.gz latex-image.tar.gz source.tar");
      assert.equal(attempt(join(directory, "bundle.tar"), bundle).status, 0);
      run("tar -cf extra.tar image.tar.gz plain.txt");
      assert.notEqual(attempt(join(directory, "extra.tar"), bundle).status, 0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test("activation requires a main commit and a release record written by the release job", async () => {
  const { spawnSync } = await import("node:child_process");
  const { createHash } = await import("node:crypto");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const source = await activator();
  const script = source.match(
    /"\$PROVENANCE_COMPARE" "\$PROVENANCE_STATUSES" "\$IMAGE_ARCHIVE_SHA" "\$LATEX_ARCHIVE_SHA" "\$SOURCE_ARCHIVE_SHA" <<'JS'\n([\s\S]*?)\nJS/u,
  )?.[1];
  assert(script, "Provenance verifier is present");
  const hashes = ["1", "2", "3"].map((digit) => digit.repeat(64));
  const digest = createHash("sha256")
    .update(`image=${hashes[0]}\nlatex=${hashes[1]}\nsource=${hashes[2]}\n`)
    .digest("hex");
  const record = {
    context: "publisle-pdf-release",
    state: "success",
    creator: { login: "github-actions[bot]", type: "Bot" },
    description: `publisle-pdf-release sha256:${digest}`,
  };
  const directory = await mkdtemp(join(tmpdir(), "publisle-provenance-"));
  const verify = async (compare, statuses, archives = hashes) => {
    await writeFile(join(directory, "compare.json"), JSON.stringify(compare));
    await writeFile(join(directory, "statuses.json"), JSON.stringify(statuses));
    return spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-",
        join(directory, "compare.json"),
        join(directory, "statuses.json"),
        ...archives,
      ],
      { input: script, encoding: "utf8", timeout: 5000 },
    ).status;
  };
  try {
    for (const status of ["behind", "identical"])
      assert.equal(await verify({ status }, [record]), 0);
    // Not on main.
    for (const status of ["ahead", "diverged"])
      assert.notEqual(await verify({ status }, [record]), 0);
    // No record, a failed record, or a record someone else wrote.
    assert.notEqual(await verify({ status: "behind" }, []), 0);
    assert.notEqual(
      await verify({ status: "behind" }, [{ ...record, state: "failure" }]),
      0,
    );
    assert.notEqual(
      await verify({ status: "behind" }, [
        { ...record, creator: { login: "someone", type: "User" } },
      ]),
      0,
    );
    // A swapped archive no longer matches the recorded digest.
    for (const index of [0, 1, 2]) {
      const swapped = [...hashes];
      swapped[index] = "4".repeat(64);
      assert.notEqual(await verify({ status: "behind" }, [record], swapped), 0);
    }
    // The newest record decides; an older matching record cannot be replayed.
    assert.notEqual(
      await verify({ status: "behind" }, [
        {
          ...record,
          description: "publisle-pdf-release sha256:" + "9".repeat(64),
        },
        record,
      ]),
      0,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "the deploy key and the host key can run only their fixed commands",
  {
    skip: process.platform === "win32",
  },
  async () => {
    const { spawnSync } = await import("node:child_process");
    const receive = new URL(
      "../../deploy/vps/publisle-receive",
      import.meta.url,
    ).pathname;
    const sync = new URL("../../deploy/vps/publisle-host-sync", import.meta.url)
      .pathname;
    const sha = "a".repeat(40);
    const run = (script, command) =>
      spawnSync("bash", [script], {
        env: { PATH: process.env.PATH, SSH_ORIGINAL_COMMAND: command },
        encoding: "utf8",
        timeout: 5000,
      });
    for (const command of [
      "",
      "bash",
      "sh -c id",
      "status; id",
      "stage",
      `stage ${sha}; id`,
      `stage ${sha} extra`,
      `stage ${sha.toUpperCase()}`,
      `activate ${"a".repeat(39)}`,
      `activate $(id)`,
      `cleanup ../${sha}`,
      `sync ${sha}`,
      `scp -t /tmp`,
    ])
      assert.equal(run(receive, command).status, 2, command);
    assert.equal(run(receive, "status").status, 0);
    for (const command of [
      "",
      "bash",
      `sync ${sha}; id`,
      `sync ${"a".repeat(39)}`,
      `stage ${sha}`,
    ])
      assert.equal(run(sync, command).status, 2, command);
    // Neither privileged entry point does anything without root.
    const activate = new URL(
      "../../deploy/vps/activate-release.sh",
      import.meta.url,
    ).pathname;
    if (process.getuid() !== 0)
      assert.notEqual(
        spawnSync("bash", [activate, "stage", sha], { encoding: "utf8" })
          .status,
        0,
      );
  },
);
