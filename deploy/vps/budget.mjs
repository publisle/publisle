// Host-sized PDF budget. One CPU and 1 GiB stay with the OS, Caddy, and nginx.
// The slice receives the rest. Swap stays off. A host that cannot leave that
// reserve and still compile fails instead of guessing a smaller cap.
import { availableParallelism, totalmem } from "node:os";
import { readFileSync } from "node:fs";

export const HOST_CPU_RESERVE = 1;
export const HOST_MEMORY_RESERVE_MIB = 1024;
export const API_MEMORY_RESERVE_MIB = 64;
export const MINIMUM_WORKER_MEMORY_MIB = 448;

export function budgetForHost(cpus, memoryMiB) {
  const aggregateCpu = Math.floor(Number(cpus)) - HOST_CPU_RESERVE;
  const aggregateMemoryMiB =
    Math.floor(Number(memoryMiB)) - HOST_MEMORY_RESERVE_MIB;
  const workerMemoryMiB = aggregateMemoryMiB - API_MEMORY_RESERVE_MIB;
  if (
    !Number.isFinite(aggregateCpu) ||
    aggregateCpu < 1 ||
    !Number.isFinite(workerMemoryMiB) ||
    workerMemoryMiB < MINIMUM_WORKER_MEMORY_MIB
  ) {
    throw new Error(
      `Host has ${cpus} CPUs and ${memoryMiB} MiB. Reserving ${HOST_CPU_RESERVE} CPU and ${HOST_MEMORY_RESERVE_MIB} MiB does not leave a compilable PDF budget.`,
    );
  }
  return {
    aggregateCpu,
    aggregateMemoryMiB,
    workerCpus: aggregateCpu,
    workerMemoryMiB,
  };
}

export function thisHostBudget() {
  return budgetForHost(
    availableParallelism(),
    Math.floor(totalmem() / (1024 * 1024)),
  );
}

export function budgetFilePath() {
  return process.env.PDF_BUDGET_FILE ?? "/etc/publisle-pdf-budget.json";
}

export function readInstalledBudget() {
  try {
    const parsed = JSON.parse(readFileSync(budgetFilePath(), "utf8"));
    if (
      typeof parsed.aggregateCpu !== "number" ||
      typeof parsed.aggregateMemoryMiB !== "number" ||
      typeof parsed.workerCpus !== "number" ||
      typeof parsed.workerMemoryMiB !== "number"
    )
      return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

export function activeBudget() {
  return readInstalledBudget() ?? thisHostBudget();
}

export function workerBudget() {
  if (process.env.PDF_WORKER_CPUS && process.env.PDF_WORKER_MEMORY_MIB) {
    return {
      cpus: Number(process.env.PDF_WORKER_CPUS),
      memoryMiB: Number(process.env.PDF_WORKER_MEMORY_MIB),
    };
  }
  const budget = activeBudget();
  return { cpus: budget.workerCpus, memoryMiB: budget.workerMemoryMiB };
}

export function sliceUnit(budget) {
  return `[Unit]
Description=Aggregate budget for Publisle PDF API, runtime and compilation

[Slice]
CPUQuota=${budget.aggregateCpu * 100}%
MemoryAccounting=true
MemoryMax=${budget.aggregateMemoryMiB}M
MemorySwapMax=0
TasksMax=160
`;
}
