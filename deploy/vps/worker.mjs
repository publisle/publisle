import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { LIMITS, ServiceError } from "./limits.mjs";
import { workerBudget } from "./budget.mjs";

const execute = promisify(execFile);
export function workerArguments(image, name, directory, action) {
  const limits = workerBudget();
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("PDF_WORKER_IMAGE must be an immutable local image ID.");
  const parent = process.env.PDF_CGROUP_PARENT;
  if (parent && !/^[A-Za-z0-9-]+\.slice$/.test(parent))
    throw new Error("Invalid worker cgroup parent.");
  return [
    "run",
    ...(parent ? ["--cgroup-parent", parent] : []),
    "--rm",
    "--pull=never",
    "--name",
    name,
    "--label",
    "publisle.pdf=true",
    "--log-driver=none",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=64",
    `--cpus=${limits.cpus}`,
    `--memory=${limits.memoryMiB}m`,
    `--memory-swap=${limits.memoryMiB}m`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
    "--ulimit",
    "fsize=33554432:33554432",
    "--ulimit",
    "nofile=128:128",
    "--mount",
    `type=bind,source=${directory},target=/input,readonly`,
    "--user",
    "0:0",
    image,
    action,
  ];
}

export async function runWorker(
  image,
  directory,
  action,
  signal,
  onContainer = () => {},
  onPrepared = undefined,
) {
  signal.throwIfAborted();
  const name = `publisle-pdf-${randomUUID()}`;
  onContainer(name);
  const chunks = [];
  let size = 0;
  let failure;
  const maxBytes =
    action === "prepare"
      ? 1024 * 1024
      : LIMITS.pdfBytes + 65536 + (onPrepared ? 1024 * 1024 : 0);
  let prefix = Buffer.alloc(0);
  let preparedSeen = false;
  let preparing = Promise.resolve();
  const cleanup = () =>
    execute("docker", ["rm", "--force", name], { timeout: 5000 }).catch(
      () => undefined,
    );
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        "docker",
        workerArguments(image, name, directory, action),
        { stdio: ["ignore", "pipe", "ignore"] },
      );
      const abort = () => {
        child.kill("SIGKILL");
        void cleanup();
      };
      signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          failure = new ServiceError(
            "output-limit",
            "Compiler output exceeds its limit.",
          );
          abort();
        } else if (onPrepared && !preparedSeen) {
          prefix = Buffer.concat([prefix, chunk]);
          const end = prefix.indexOf(10);
          if (end < 0) {
            if (prefix.length > 1024 * 1024) {
              failure = new ServiceError(
                "output-limit",
                "Preparation output exceeds its limit.",
              );
              abort();
            }
            return;
          }
          if (end > 1024 * 1024) {
            failure = new ServiceError(
              "output-limit",
              "Preparation output exceeds its limit.",
            );
            abort();
            return;
          }
          preparedSeen = true;
          const header = prefix.subarray(0, end);
          chunks.push(prefix.subarray(end + 1));
          prefix = Buffer.alloc(0);
          preparing = Promise.resolve()
            .then(() => onPrepared(JSON.parse(header.toString("utf8"))))
            .catch((error) => {
              failure = error;
              abort();
            });
        } else chunks.push(chunk);
      });
      child.on("error", reject);
      child.on("close", async (code) => {
        await preparing;
        signal.removeEventListener("abort", abort);
        if (signal.aborted) {
          reject(signal.reason);
          return;
        }
        if (failure) {
          reject(failure);
          return;
        }
        const body = Buffer.concat(preparedSeen ? chunks : [prefix, ...chunks]);
        if (code === 137) {
          reject(
            new ServiceError(
              "resource-limit",
              "This document exceeds the PDF service memory budget.",
            ),
          );
          return;
        }
        if (code !== 0) {
          let message = "PDF compilation failed within the service limits.";
          let errorCode = "compilation-failed";
          let diagnostics = [];
          try {
            const detail = JSON.parse(body.toString("utf8"));
            message = String(detail.message).slice(0, 300);
            errorCode = detail.code;
            diagnostics = Array.isArray(detail.diagnostics)
              ? detail.diagnostics
                  .slice(0, 30)
                  .filter(
                    (entry) =>
                      typeof entry.code === "string" &&
                      typeof entry.message === "string",
                  )
                  .map(({ code, message, blockIndex }) => ({
                    code: code.slice(0, 100),
                    message: message.slice(0, 300),
                    ...(Number.isSafeInteger(blockIndex) && blockIndex >= 0
                      ? { blockIndex }
                      : {}),
                  }))
              : [];
          } catch {
            /* bounded generic failure */
          }
          reject(
            Object.assign(new ServiceError(errorCode, message), {
              diagnostics,
            }),
          );
          return;
        }
        if (onPrepared && !preparedSeen) {
          reject(
            new ServiceError("invalid-worker", "Missing preparation record."),
          );
          return;
        }
        resolve(body);
      });
    });
    return result;
  } finally {
    await cleanup();
    onContainer(undefined);
  }
}
