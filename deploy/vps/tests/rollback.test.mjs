import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function prune(root, current) {
  const source = await readFile(
    new URL("../activate-release.sh", import.meta.url),
    "utf8",
  );
  const match = source.match(
    /# BEGIN prune_rollbacks\n([\s\S]*?)# END prune_rollbacks\n/u,
  );
  assert.ok(match?.[1], "prune_rollbacks is missing from activate-release.sh");
  await execute("bash", [
    "-c",
    `${match[1]}\nprune_rollbacks "$1" "$2"`,
    "bash",
    root,
    current,
  ]);
}

async function snapshot(currentName) {
  const directory = await mkdtemp(join(tmpdir(), "publisle-rollback-"));
  const names = [
    "rollback-1",
    "rollback-2",
    "rollback-3",
    "rollback-4",
    "rollback-5",
  ];
  const start = Math.floor(Date.now() / 1000) - 1000;
  for (const [index, name] of names.entries()) {
    const path = join(directory, name);
    await mkdir(path);
    await writeFile(join(path, "marker"), name);
    const time = new Date((start + index * 10) * 1000);
    await utimes(path, time, time);
  }
  await mkdir(join(directory, "keep-me"));
  await writeFile(join(directory, "rollback-not-a-directory"), "file");
  await prune(directory, join(directory, currentName));
  return {
    directory,
    names: await readdir(directory),
  };
}

test("activation keeps the newest three rollback directories and the current backup", async () => {
  const newest = await snapshot("rollback-5");
  try {
    assert.deepEqual(newest.names.sort(), [
      "keep-me",
      "rollback-3",
      "rollback-4",
      "rollback-5",
      "rollback-not-a-directory",
    ]);
  } finally {
    await execute("rm", ["-rf", newest.directory]);
  }

  const oldest = await snapshot("rollback-1");
  try {
    assert.deepEqual(oldest.names.sort(), [
      "keep-me",
      "rollback-1",
      "rollback-3",
      "rollback-4",
      "rollback-5",
      "rollback-not-a-directory",
    ]);
  } finally {
    await execute("rm", ["-rf", oldest.directory]);
  }
});
