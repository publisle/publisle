// Internal local QA only. A dedicated rootless daemon, API and all compilation
// workers share a transient user slice. The existing Docker daemon is untouched.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import { mkdir, readFile, writeFile, mkdtemp } from "node:fs/promises";
import { resolve, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createApi } from "./server.mjs";
import { TEMPLATES } from "./limits.mjs";
import { thisHostBudget } from "./budget.mjs";

const execute = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");
const imageTag = process.env.PDF_QA_IMAGE ?? "publisle-pdf-worker:local";
const slice = "publislepdfqa.slice";
const runtimeUnit = "publislepdfqa-runtime";
const workerUnit = "publislepdfqa-check";
const artifactDirectory = resolve(
  process.env.PDF_QA_ARTIFACTS ?? join(root, ".local/pdf-service-qa"),
);

if (
  process.argv.includes("--inside") &&
  process.env.PDF_QA_BENCHMARK === "true"
) {
  await import("./benchmark.mjs");
} else if (process.argv.includes("--inside")) {
  const image = (
    await execute("docker", [
      "image",
      "inspect",
      imageTag,
      "--format",
      "{{.Id}}",
    ])
  ).stdout.trim();
  const cgroup = (
    await execute("systemctl", [
      "--user",
      "show",
      slice,
      "-p",
      "ControlGroup",
      "--value",
    ])
  ).stdout.trim();
  const group = `/sys/fs/cgroup${cgroup}`;
  const api = createApi({
    ready: true,
    image,
    assetBase: "https://publisle.xyz/",
    limits: { attempts: 50, queueSize: 2, queueMs: 30000, quotaMs: 600000 },
  });
  api.server.listen(0, "127.0.0.1");
  await once(api.server, "listening");
  const base = `http://127.0.0.1:${api.server.address().port}`;
  let peak = 0;
  const samples = [];
  const sampler = setInterval(() => {
    void readFile(`${group}/memory.current`, "utf8").then((value) => {
      peak = Math.max(peak, Number(value));
    });
  }, 100);
  const beforeEvents = await readFile(`${group}/memory.events`, "utf8");
  try {
    for (const template of TEMPLATES) {
      let markdown = await readFile(
        join(
          root,
          "examples/articles",
          template.id === "article-arabic"
            ? "article-arabic.md"
            : "ieee-journal.md",
        ),
        "utf8",
      );
      markdown = markdown.replaceAll(
        'src="ieee-square-wave.pdf"',
        'src="https://publisle.xyz/favicon.svg"',
      );
      const start = performance.now();
      const response = await fetch(`${base}/pdf/compile`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/pdf",
        },
        body: JSON.stringify({
          markdown,
          template: template.id,
          data: { country: "Jordan" },
        }),
      });
      if (!response.ok) {
        const failure = {
          template: template.id,
          durationMs: Math.round(performance.now() - start),
          failure: await response.json(),
        };
        samples.push(failure);
        console.log(JSON.stringify(failure));
        continue;
      }
      const pdf = Buffer.from(await response.arrayBuffer());
      await writeFile(join(artifactDirectory, `${template.id}.pdf`), pdf);
      const health = await fetch(`${base}/health`);
      if (!health.ok) throw new Error("API did not recover after compilation");
      const sample = {
        template: template.id,
        durationMs: Math.round(performance.now() - start),
        pdfBytes: pdf.length,
      };
      samples.push(sample);
      console.log(JSON.stringify(sample));
    }
    const report = {
      image,
      passed: !samples.some((sample) => sample.failure),
      aggregateCpu: Number(process.env.PDF_AGGREGATE_CPU),
      aggregateMemoryMiB: Number(process.env.PDF_AGGREGATE_MEMORY_MIB),
      sampledPeakMiB: Math.round(peak / 1024 / 1024),
      beforeEvents,
      afterEvents: await readFile(`${group}/memory.events`, "utf8"),
      samples,
    };
    await writeFile(
      join(artifactDirectory, "budget.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
    if (samples.some((sample) => sample.failure))
      throw new Error(
        "One or more template fixtures failed the aggregate budget gate.",
      );
  } finally {
    clearInterval(sampler);
    api.shutdown();
  }
} else {
  await mkdir(artifactDirectory, { recursive: true });
  const runtimeBase = join(root, "node_modules/.cache/publisle-pdf-qa");
  await mkdir(runtimeBase, { recursive: true });
  const runtimeDirectory = await mkdtemp(join(runtimeBase, "runtime-"));
  const controlDirectory = await mkdtemp("/tmp/publisle-pdf-runtime-");
  const socket = join(controlDirectory, "docker.sock");
  const qaEnv = {
    ...process.env,
    DOCKER_HOST: `unix://${socket}`,
    PDF_CGROUP_PARENT: slice,
  };
  let started = false;
  try {
    await execute("systemd-run", [
      "--user",
      "--collect",
      `--unit=${runtimeUnit}`,
      `--slice=${slice}`,
      "--property=Delegate=yes",
      `--setenv=DOCKERD_ROOTLESS_ROOTLESSKIT_STATE_DIR=${join(controlDirectory, "rootlesskit")}`,
      "dockerd-rootless.sh",
      `--host=unix://${socket}`,
      `--data-root=${join(runtimeDirectory, "data")}`,
      `--exec-root=${join(controlDirectory, "exec")}`,
      `--pidfile=${join(controlDirectory, "daemon.pid")}`,
      "--bridge=none",
      "--iptables=false",
      "--ip6tables=false",
    ]);
    started = true;
    let available = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      await delay(500);
      try {
        await execute("docker", ["info"], { env: qaEnv, timeout: 1000 });
        available = true;
        break;
      } catch {
        /* wait for rootless daemon */
      }
    }
    if (!available)
      throw new Error(
        `QA runtime failed to start. Inspect journalctl --user -u ${runtimeUnit}.`,
      );
    // Image installation is provisioning; impose the compilation budget after it.
    const save = spawn("docker", ["save", imageTag], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    const load = spawn("docker", ["load", "--quiet"], {
      env: qaEnv,
      stdio: ["pipe", "inherit", "inherit"],
    });
    save.stdout.pipe(load.stdin);
    const codes = await Promise.all([once(save, "close"), once(load, "close")]);
    if (codes.some(([code]) => code !== 0))
      throw new Error("QA image transfer failed");
    const hostBudget = thisHostBudget();
    await execute("systemctl", [
      "--user",
      "set-property",
      "--runtime",
      slice,
      `MemoryMax=${hostBudget.aggregateMemoryMiB}M`,
      "MemoryHigh=infinity",
      "MemorySwapMax=0",
      `CPUQuota=${hostBudget.aggregateCpu * 100}%`,
    ]);
    const args = [
      "--user",
      "--wait",
      "--pipe",
      "--collect",
      `--unit=${workerUnit}`,
      `--slice=${slice}`,
      `--working-directory=${root}`,
      `--setenv=DOCKER_HOST=${qaEnv.DOCKER_HOST}`,
      `--setenv=PDF_CGROUP_PARENT=${slice}`,
      `--setenv=PDF_QA_ARTIFACTS=${artifactDirectory}`,
      `--setenv=PDF_AGGREGATE_CPU=${hostBudget.aggregateCpu}`,
      `--setenv=PDF_AGGREGATE_MEMORY_MIB=${hostBudget.aggregateMemoryMiB}`,
      `--setenv=PDF_WORKER_CPUS=${hostBudget.workerCpus}`,
      `--setenv=PDF_WORKER_MEMORY_MIB=${hostBudget.workerMemoryMiB}`,
      ...[
        "PDF_QA_IMAGE",
        "PDF_QA_BENCHMARK",
        "PDF_BENCH_SERVER",
        "PDF_BENCH_NATIVE",
        "PDF_BENCH_RUST",
        "PDF_BENCH_SAMPLES",
        "PDF_BENCH_WARMUPS",
        "PDF_BENCH_CASES",
      ].flatMap((key) =>
        process.env[key] ? [`--setenv=${key}=${process.env[key]}`] : [],
      ),
      process.execPath,
      "--max-old-space-size=48",
      import.meta.filename,
      "--inside",
    ];
    const child = spawn("systemd-run", args, { stdio: "inherit" });
    const [code] = await once(child, "close");
    if (code !== 0)
      throw new Error(
        "Aggregate resource-budget gate failed; PDF must remain disabled.",
      );
  } finally {
    if (started)
      await execute("systemctl", [
        "--user",
        "stop",
        `${runtimeUnit}.service`,
        slice,
      ]).catch(() => {});
    // Retain the dedicated daemon data beside reports for debugging. It is never
    // shared with production or the user's normal Docker runtime.
    console.log(`QA artifacts: ${artifactDirectory}`);
  }
}
