#!/usr/bin/env node
/**
 * ArchPulse CLI entry point (Owner B)
 *
 * Commands:
 *   archpulse scan   [--repo <path>] [--out <dir>] [--config <file>] [--scope <path>]
 *   archpulse cases  <forwarded to Owner C implementation>
 *   archpulse compare <forwarded to Owner E implementation>
 *
 * Usage via npm scripts:
 *   npm run scan
 *   npm run cases
 *   npm run compare
 */

import { runScan, type ScanSummary } from "./scan.js";

// ─── Argument parsing (no external deps) ─────────────────────────────────────

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  const args = argv.slice(2); // strip node + script path
  const command = args[0] ?? "help";
  const flags: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg !== undefined && arg.startsWith("--")) {
      const key = arg.slice(2);
      const val = args[i + 1];
      if (val !== undefined && !val.startsWith("--")) {
        flags[key] = val;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

// ─── Commands ─────────────────────────────────────────────────────────────────

async function cmdScan(flags: Record<string, string>): Promise<void> {
  const repoRoot = flags["repo"] ? flags["repo"] : process.cwd();
  const outDir = flags["out"];
  const configPath = flags["config"];
  const scanScope = flags["scope"];

  console.error("[archpulse scan] starting...");

  let summary: ScanSummary;
  try {
    summary = await runScan({
      repoRoot,
      ...(outDir ? { outDir } : {}),
      ...(configPath ? { configPath } : {}),
      ...(scanScope ? { scanScope } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[archpulse scan] ERROR: ${msg}`);
    process.exit(2);
  }

  console.error(
    `[archpulse scan] done — ${summary.violationCount} violation(s) ` +
      `(${summary.errorCount} error, ${summary.warnCount} warn)`
  );
  console.error(`  snapshot → ${summary.snapshotPath}`);
  console.error(`  graph    → ${summary.graphPath}`);
  console.error(`  unresolved dependency edges: ${summary.incompleteResolutionCount}`);
  for (const warning of summary.scannerWarnings) console.error(`  Warning: ${warning}`);

  // Print a human-readable table of violations to stdout
  if (summary.violations.length === 0) {
    console.log(summary.incompleteResolutionCount
      ? "No violations detected among resolved dependencies; scan coverage is incomplete."
      : "No violations found.");
  } else {
    console.log(`\nViolations (${summary.violationCount}):\n`);
    for (const v of summary.violations) {
      console.log(`  [${v.severity.toUpperCase()}] ${v.rule}`);
      console.log(`    from: ${v.from}`);
      console.log(`    to:   ${v.to}`);
      console.log(`    id:   ${v.id}`);
      console.log();
    }
  }
}

function cmdCases(_flags: Record<string, string>): void {
  // Delegated to Owner C (src/cli/cases.ts).
  // This stub keeps the CLI entry point wired so the MCP server can register
  // the tool name before the implementation lands.
  console.error(
    "[archpulse cases] Not yet implemented — Owner C (grouping) owns this command."
  );
  process.exit(1);
}

function cmdCompare(_flags: Record<string, string>): void {
  // Delegated to Owner E (src/cli/compare.ts).
  console.error(
    "[archpulse compare] Not yet implemented — Owner E (verifier) owns this command."
  );
  process.exit(1);
}

function cmdHelp(): void {
  console.log(`
ArchPulse CLI

Usage:
  archpulse scan     [--repo <path>] [--out <dir>] [--config <file>] [--scope <path>]
  archpulse cases    --snapshot <path> [--out <dir>]
  archpulse compare  --before <path> --after <path> [--case <id>] [--out <dir>]

Options:
  --repo     Absolute or relative path to the repository root (default: cwd)
  --out      Directory to write artifacts into
  --config   Path to .dependency-cruiser config (default: .dependency-cruiser.cjs)
  --scope    Override scan scope path (default: from config/architecture.json)
`);
}

// ─── Entry ────────────────────────────────────────────────────────────────────

const { command, flags } = parseArgs(process.argv);

switch (command) {
  case "scan":
    await cmdScan(flags);
    break;
  case "cases":
    cmdCases(flags);
    break;
  case "compare":
    cmdCompare(flags);
    break;
  default:
    cmdHelp();
    break;
}
