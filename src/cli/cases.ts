/**
 * cases.ts — Owner C
 *
 * CLI command: archpulse cases
 *
 *   Usage: cases --snapshot <path> --out <dir> [--config <path>]
 *
 * This module owns filesystem loading/writing and orchestration only.
 * It does NOT own the global CLI dispatcher (src/cli/index.ts — Owner B).
 * It exports a runCases() function so that the dispatcher can call it when
 * ready, and also supports direct invocation for development and testing.
 */

import fs from "node:fs";
import path from "node:path";

import { groupViolations } from "../core/grouping.js";
import { buildCasePacket } from "../core/casePacket.js";
import type { ArchitectureConfig } from "../core/casePacket.js";
import type { SnapshotInput } from "../core/grouping.js";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

interface CasesArgs {
  snapshotPath: string;
  outDir: string;
  configPath: string;
}

function parseArgs(argv: string[]): CasesArgs {
  const args: Partial<CasesArgs> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--snapshot" && argv[i + 1]) {
      args.snapshotPath = argv[++i];
    } else if (arg === "--out" && argv[i + 1]) {
      args.outDir = argv[++i];
    } else if (arg === "--config" && argv[i + 1]) {
      args.configPath = argv[++i];
    }
  }
  if (!args.snapshotPath) {
    throw new Error("Missing required argument: --snapshot <path>");
  }
  if (!args.outDir) {
    throw new Error("Missing required argument: --out <dir>");
  }
  return {
    snapshotPath: args.snapshotPath,
    outDir: args.outDir,
    configPath: args.configPath ?? "config/architecture.json",
  };
}

// ---------------------------------------------------------------------------
// Loading and validation
// ---------------------------------------------------------------------------

function loadSnapshot(snapshotPath: string): SnapshotInput {
  const resolved = path.resolve(snapshotPath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    throw new Error(`Cannot read snapshot file '${snapshotPath}': ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`snapshot file '${snapshotPath}' is not valid JSON`);
  }

  const obj = parsed as Record<string, unknown>;

  if (obj["schemaVersion"] !== "1") {
    throw new Error(
      `Unsupported snapshot schemaVersion '${obj["schemaVersion"]}'. Expected '1'.`,
    );
  }
  if (!Array.isArray(obj["violations"])) {
    throw new Error(`snapshot file '${snapshotPath}' is missing the 'violations' array`);
  }

  return obj as unknown as SnapshotInput;
}

function loadConfig(configPath: string): ArchitectureConfig {
  const resolved = path.resolve(configPath);
  let raw: string;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    throw new Error(`Cannot read config file '${configPath}': ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`config file '${configPath}' is not valid JSON`);
  }

  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj["testCommands"])) {
    throw new Error(`config file '${configPath}' is missing the 'testCommands' array`);
  }
  if (!Array.isArray(obj["layers"])) {
    throw new Error(`config file '${configPath}' is missing the 'layers' array`);
  }

  return obj as unknown as ArchitectureConfig;
}

// ---------------------------------------------------------------------------
// Case ID assignment
// ---------------------------------------------------------------------------

function toCaseId(index: number): string {
  return `case-${String(index + 1).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

/** Index entry written to index.json */
interface CaseIndexEntry {
  caseId: string;
  title: string;
  rule: string;
  severity: "error" | "warn";
  violationCount: number;
  primaryFileCount: number;
}

function writeOutputs(
  outDir: string,
  entries: CaseIndexEntry[],
  cases: Array<{ caseId: string; json: object; markdown: string }>,
): void {
  fs.mkdirSync(outDir, { recursive: true });

  for (const { caseId, json, markdown } of cases) {
    fs.writeFileSync(
      path.join(outDir, `${caseId}.json`),
      JSON.stringify(json, null, 2) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(outDir, `${caseId}.md`),
      markdown,
      "utf8",
    );
  }

  const index = { cases: entries };
  fs.writeFileSync(
    path.join(outDir, "index.json"),
    JSON.stringify(index, null, 2) + "\n",
    "utf8",
  );
}

// ---------------------------------------------------------------------------
// CLI summary
// ---------------------------------------------------------------------------

function printSummary(entries: CaseIndexEntry[], outDir: string): void {
  const col = (s: string, w: number) => s.padEnd(w).slice(0, w);
  const header = `${col("Case ID", 10)} ${col("Rule", 24)} ${col("Sev", 5)} ${col("Viols", 5)} ${col("Files", 5)}`;
  const sep = "-".repeat(header.length);
  process.stdout.write(`\narchpulse cases\n${sep}\n${header}\n${sep}\n`);
  for (const e of entries) {
    process.stdout.write(
      `${col(e.caseId, 10)} ${col(e.rule, 24)} ${col(e.severity, 5)} ${col(String(e.violationCount), 5)} ${col(String(e.primaryFileCount), 5)}\n`,
    );
  }
  process.stdout.write(`${sep}\n`);
  process.stdout.write(`${entries.length} case(s) written to: ${outDir}\n\n`);
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

export interface RunCasesResult {
  caseCount: number;
  outDir: string;
  /** Any packets that exceeded the ~2 KB budget */
  oversizedCases: string[];
}

/**
 * Main entry point for the `archpulse cases` command.
 * argv should be the argument list AFTER the "cases" subcommand token
 * (i.e. process.argv.slice(3) when called from the dispatcher).
 */
export async function runCases(argv: string[]): Promise<RunCasesResult> {
  const args = parseArgs(argv);

  const snapshot = loadSnapshot(args.snapshotPath);
  const config = loadConfig(args.configPath);

  const groups = groupViolations(snapshot);

  if (groups.length === 0) {
    process.stdout.write("No violations found in snapshot — no cases generated.\n");
    fs.mkdirSync(args.outDir, { recursive: true });
    fs.writeFileSync(
      path.join(args.outDir, "index.json"),
      JSON.stringify({ cases: [] }, null, 2) + "\n",
      "utf8",
    );
    return { caseCount: 0, outDir: args.outDir, oversizedCases: [] };
  }

  const entries: CaseIndexEntry[] = [];
  const cases: Array<{ caseId: string; json: object; markdown: string }> = [];
  const oversizedCases: string[] = [];

  for (let i = 0; i < groups.length; i++) {
    const caseId = toCaseId(i);
    const group = groups[i];
    if (group === undefined) continue;
    const result = buildCasePacket(caseId, group, snapshot, config);

    if (result.exceedsBudget) {
      process.stderr.write(
        `Warning: ${caseId} packet is ${result.jsonByteLength} bytes ` +
          `(budget: 2048 bytes). Consider reducing violations or primary files.\n`,
      );
      oversizedCases.push(caseId);
    }

    entries.push({
      caseId,
      title: result.json.title,
      rule: result.json.rule,
      severity: result.json.severity,
      violationCount: result.json.violations.length,
      primaryFileCount: result.json.primaryFiles.length,
    });
    cases.push({ caseId, json: result.json, markdown: result.markdown });
  }

  writeOutputs(args.outDir, entries, cases);
  printSummary(entries, args.outDir);

  return { caseCount: groups.length, outDir: args.outDir, oversizedCases };
}

// ---------------------------------------------------------------------------
// Direct invocation support (tsx src/cli/cases.ts --snapshot ... --out ...)
// ---------------------------------------------------------------------------

// Detect whether this file is being run directly.
// Works for both `node dist/cli/cases.js` and `tsx src/cli/cases.ts`.
const isMain =
  process.argv[1] != null &&
  (process.argv[1].endsWith("cases.ts") ||
    process.argv[1].endsWith("cases.js"));

if (isMain) {
  runCases(process.argv.slice(2)).catch((err: Error) => {
    process.stderr.write(`Error: ${err.message}\n`);
    process.exit(1);
  });
}
