import { availableParallelism, totalmem } from "node:os";
import { defineConfig } from "vitest/config";

const cpus = availableParallelism();
const memoryMiB = Math.floor(totalmem() / (1024 * 1024));
const maxWorkers = Math.max(
  1,
  Math.min(cpus, Math.floor((memoryMiB - 2048) / 1024)),
);
const heapMiB = Math.max(512, Math.floor((memoryMiB - 2048) / maxWorkers));

export default defineConfig({
  test: {
    // Use every logical CPU that still leaves about 1 GiB of heap per worker
    // and 2 GiB for the runner. Acceptance files stay in their own config.
    maxWorkers,
    execArgv: [`--max-old-space-size=${String(heapMiB)}`],
    exclude: ["**/*.acceptance.test.ts", "**/*.integration.test.ts"],
    include: [
      "packages/*/tests/**/*.test.ts",
      "examples/playground-core/tests/**/*.test.ts",
      "sites/www/tests/**/*.test.ts",
      "tools/tests/**/*.test.ts",
    ],
  },
});
