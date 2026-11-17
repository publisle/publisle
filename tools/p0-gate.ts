import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isPlainObject, parseJson } from "../packages/schema/src/index.ts";

interface Evidence {
  readonly file: string;
  readonly title: string;
  readonly status: string;
}

function reportEvidence(value: unknown): Evidence[] {
  if (!isPlainObject(value) || !Array.isArray(value["testResults"]))
    throw new Error("Missing test evidence report");
  const evidence: Evidence[] = [];
  for (const suite of value["testResults"] as unknown[]) {
    if (
      !isPlainObject(suite) ||
      typeof suite["name"] !== "string" ||
      !Array.isArray(suite["assertionResults"])
    )
      throw new Error("Malformed test suite evidence");
    for (const test of suite["assertionResults"] as unknown[]) {
      if (
        !isPlainObject(test) ||
        typeof test["fullName"] !== "string" ||
        typeof test["status"] !== "string"
      )
        throw new Error("Malformed assertion evidence");
      evidence.push({
        file: suite["name"],
        title: test["fullName"],
        status: test["status"],
      });
    }
  }
  if (!evidence.length || evidence.some((entry) => entry.status !== "passed"))
    throw new Error(
      "P0 gate requires all tests passing; skipped/missing evidence is not conformance",
    );
  return evidence;
}

export function verifyP0Evidence(
  evidence: readonly Evidence[],
): Readonly<Record<string, readonly Evidence[]>> {
  const require = (file: string, title: string, minimum = 1) => {
    const found = evidence.filter(
      (entry) =>
        entry.file.endsWith(file) &&
        entry.title.includes(title) &&
        entry.status === "passed",
    );
    if (found.length < minimum)
      throw new Error(`Missing P0 evidence: ${file} / ${title}`);
    return found;
  };
  const both = (title: string) => [
    ...require("adapter-react/tests/production.acceptance.test.ts", title),
    ...require("adapter-svelte/tests/production.acceptance.test.ts", title),
  ];
  return {
    "TEST-01": [
      ...require("contracts/tests/independent.test.ts", "shared JCS"),
      ...require("contracts/tests/independent.test.ts", "shared built-in structural"),
      ...require("contracts/tests/independent.test.ts", "schema classifications"),
    ],
    "TEST-02": [
      ...require("contracts/tests/independent.test.ts", "complete built-in closure"),
      ...require("contracts/tests/export.test.ts", "transitive block dependencies"),
      ...require("contracts/tests/independent.test.ts", "locked documents and exact transitive pins"),
    ],
    "TEST-03": require("contracts/tests/meaning.test.ts", "unfamiliar inputs, outputs and actions from JSON alone"),
    "TEST-04": require("contracts/tests/export.test.ts", "records normalization/refinements/migrations"),
    "TEST-05": [
      ...require("adapter-react/tests/delivery.acceptance.test.ts", "retains every JSON payload", 2),
      ...require("adapter-svelte/tests/delivery.acceptance.test.ts", "retains every JSON payload", 2),
    ],
    "TEST-06": [
      ...require("core/tests/meaning.test.ts", "retains raw payload and substantive article prose"),
      ...both("renders digest-associated unknown content without JavaScript"),
    ],
    "TEST-07": [
      ...require("contracts/tests/structural.test.ts", "unknown keywords, regexes, dialects and references"),
      ...require("contracts/tests/structural.test.ts", "excessive branching"),
      ...require("contracts/tests/export.test.ts", "detects tampering"),
    ],
    "TEST-08": [
      ...require("markdown/tests/archive.test.ts", "preserves complete identity"),
      ...require("markdown/tests/archive.test.ts", "immutable pins without regenerating IDs"),
      ...require("contracts/tests/exchange.test.ts", "round"),
    ],
    "TEST-09": [
      ...require("adapter-core/tests/python.acceptance.test.ts", "working host-owned islands"),
      ...require("adapter-core/tests/python.acceptance.test.ts", "JavaScript disabled"),
    ],
    "TEST-10": [
      ...both("static-only content without Publisle runtime/tooling"),
      ...both(
        "activates every intent, shares one module with independent state",
      ),
      ...require("adapter-core/tests/python.acceptance.test.ts", "working host-owned islands"),
    ],
    "TEST-11": [
      ...require("playground-core/tests/fourier.test.ts", "pinned samples"),
      ...require("adapter-core/tests/fourier.acceptance.test.ts", "supports keyboard presets", 4),
      ...require("contracts/tests/inspection.test.ts", "extracts unfamiliar instance values"),
      ...require("markdown/tests/reading.test.ts", "reading"),
    ],
    "TEST-12": [
      ...require("adapter-core/tests/lifecycle.acceptance.test.ts", "keyboard"),
      ...require("adapter-core/tests/lifecycle.acceptance.test.ts", "pending load"),
      ...require("adapter-core/tests/lifecycle.acceptance.test.ts", "without JavaScript"),
      ...require("adapter-core/tests/lifecycle.acceptance.test.ts", "reduced motion"),
      ...require("profiles/tests/interactive-publication.test.ts", "generic script notice"),
    ],
    "TEST-13": [
      ...require("contracts/tests/composition.test.ts", "seals the behavior profile"),
      ...require("adapter-core/tests/composition.test.ts", "restores atomically"),
      ...require("adapter-core/tests/composition.test.ts", "snapshot byte overflow"),
      ...require("adapter-core/tests/composition.test.ts", "unsupported cycles"),
      ...require("adapter-core/tests/composition.test.ts", "asynchronous host failures"),
      ...require("adapter-core/tests/composition.acceptance.test.ts", "without cross-binding repeated placements"),
    ],
  };
}

const acceptanceEvidence = [
  "packages/adapter-react/tests/production.acceptance.test.ts",
  "packages/adapter-svelte/tests/production.acceptance.test.ts",
  "packages/adapter-react/tests/delivery.acceptance.test.ts",
  "packages/adapter-svelte/tests/delivery.acceptance.test.ts",
  "packages/adapter-core/tests/python.acceptance.test.ts",
  "packages/adapter-core/tests/fourier.acceptance.test.ts",
  "packages/adapter-core/tests/lifecycle.acceptance.test.ts",
  "packages/adapter-core/tests/composition.acceptance.test.ts",
];

async function main(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), "publisle-p0-"));
  const reportFlag = process.argv.indexOf("--unit-report");
  const unitReport =
    reportFlag === -1 ? undefined : process.argv[reportFlag + 1];
  try {
    const evidence: Evidence[] = [];
    if (unitReport) {
      evidence.push(...reportEvidence(parseJson(await readFile(unitReport))));
    } else {
      execFileSync(
        process.env["PUBLISLE_PYTHON"] ?? "python3",
        ["-B", "-m", "unittest", "discover", "-s", "tools/python", "-v"],
        { stdio: "inherit", timeout: 60_000 },
      );
      const output = join(temporary, "unit.json");
      execFileSync(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--reporter=default",
          "--reporter=json",
          `--outputFile=${output}`,
        ],
        { stdio: "inherit", timeout: 300_000 },
      );
      evidence.push(...reportEvidence(parseJson(await readFile(output))));
    }
    const browserOutput = join(temporary, "browser.json");
    execFileSync(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.acceptance.config.ts",
        "--reporter=default",
        "--reporter=json",
        `--outputFile=${browserOutput}`,
        ...acceptanceEvidence,
      ],
      { stdio: "inherit", timeout: 300_000 },
    );
    evidence.push(...reportEvidence(parseJson(await readFile(browserOutput))));
    const matrix = verifyP0Evidence(evidence);
    for (const [id, tests] of Object.entries(matrix))
      console.log(
        `${id}: passed (${String(tests.length)} required evidence cases)`,
      );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
