/**
 * ArchPulse — scan runner (Owner B)
 *
 * Invokes dependency-cruiser programmatically:
 *  1. Runs `--output-type json` to get machine-readable violations.
 *  2. Runs `--output-type dot-webpage` to produce graph.html.
 *  3. Normalizes the JSON into a Snapshot and writes snapshot.json.
 *  4. Returns a compact ScanSummary for MCP / CLI consumers.
 *
 * Key constraint: depcruise exits nonzero when violations are found.
 * We distinguish that expected case (valid JSON output) from a real
 * execution error (no usable output).
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { normalizeSnapshot, type Snapshot } from "../core/snapshot.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ScanOptions {
  /** Absolute path to the repository root. Defaults to process.cwd(). */
  repoRoot?: string;
  /** Directory to write snapshot.json and graph.html into. Defaults to .archpulse/latest */
  outDir?: string;
  /** Path to .dependency-cruiser config. Defaults to .dependency-cruiser.cjs */
  configPath?: string;
  /** Override the scan scope (path passed to depcruise). Falls back to config/architecture.json */
  scanScope?: string;
}

export interface ScanSummary {
  snapshotPath: string;
  graphPath: string;
  violationCount: number;
  errorCount: number;
  warnCount: number;
  violations: Array<{ id: string; rule: string; from: string; to: string; severity: string }>;
  gitMarker: string;
  configHash: string;
}

// ─── Architecture config (minimal) ───────────────────────────────────────────

interface ArchConfig {
  layers?: Array<{ name: string; glob: string }>;
  scanScope?: string;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run dependency-cruiser against the configured scope, normalize the output,
 * persist artifacts, and return a compact summary.
 */
export async function runScan(options: ScanOptions = {}): Promise<ScanSummary> {
  const repoRoot = options.repoRoot ?? process.cwd();
  const configPath = options.configPath
    ? path.resolve(repoRoot, options.configPath)
    : path.join(repoRoot, ".dependency-cruiser.cjs");

  if (!existsSync(configPath)) {
    throw new Error(`dependency-cruiser config not found: ${configPath}`);
  }

  // Load architecture.json for layers + scan scope
  const archConfigPath = path.join(repoRoot, "config", "architecture.json");
  const archConfig: ArchConfig = existsSync(archConfigPath)
    ? (JSON.parse(readFileSync(archConfigPath, "utf8")) as ArchConfig)
    : {};

  const scanScope = options.scanScope ?? archConfig.scanScope ?? "src";
  const layerMap = archConfig.layers ?? [];

  const outDir = options.outDir
    ? path.resolve(repoRoot, options.outDir)
    : path.join(repoRoot, ".archpulse", "latest");
  mkdirSync(outDir, { recursive: true });

  // ── Config hash ────────────────────────────────────────────────────────────
  const configContent = readFileSync(configPath, "utf8");
  const configHash = createHash("sha256").update(configContent).digest("hex");

  // ── Git marker ─────────────────────────────────────────────────────────────
  const gitMarker = resolveGitMarker(repoRoot);

  // ── Scanner version ────────────────────────────────────────────────────────
  const scannerVersion = resolveScannerVersion(repoRoot);

  // ── Run depcruise → JSON ───────────────────────────────────────────────────
  const jsonOutput = runDepcruise(repoRoot, configPath, scanScope, "json");

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(jsonOutput);
  } catch {
    throw new Error(
      "dependency-cruiser produced invalid JSON output. Check config and scan scope."
    );
  }

  // ── Normalize ──────────────────────────────────────────────────────────────
  const snapshot: Snapshot = normalizeSnapshot(
    rawJson,
    repoRoot,
    configHash,
    scannerVersion,
    gitMarker,
    scanScope,
    layerMap
  );

  // ── Write snapshot.json ────────────────────────────────────────────────────
  const snapshotPath = path.join(outDir, "snapshot.json");
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), "utf8");

  // ── Run depcruise → graph.html ─────────────────────────────────────────────
  const graphPath = path.join(outDir, "graph.html");
  const dotOutput = runDepcruise(repoRoot, configPath, scanScope, "err-html");
  writeFileSync(graphPath, dotOutput, "utf8");

  // ── Build summary ──────────────────────────────────────────────────────────
  const errorCount = snapshot.violations.filter((v) => v.severity === "error").length;
  const warnCount = snapshot.violations.filter((v) => v.severity === "warn").length;

  return {
    snapshotPath: path.relative(repoRoot, snapshotPath).replace(/\\/g, "/"),
    graphPath: path.relative(repoRoot, graphPath).replace(/\\/g, "/"),
    violationCount: snapshot.violations.length,
    errorCount,
    warnCount,
    violations: snapshot.violations.map((v) => ({
      id: v.id,
      rule: v.rule,
      from: v.from,
      to: v.to,
      severity: v.severity,
    })),
    gitMarker: snapshot.gitMarker,
    configHash: snapshot.configHash,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Invoke dependency-cruiser and return stdout as a string.
 * depcruise exits nonzero when violations are found — that is EXPECTED.
 * We only throw on true execution failures (missing binary, bad config).
 */
function runDepcruise(
  repoRoot: string,
  configPath: string,
  scanScope: string,
  outputType: "json" | "err-html"
): string {
  // spawnSync with shell:true is the most reliable cross-platform way to invoke
  // npm .bin wrappers (which are .cmd files on Windows, shell scripts on Unix).
  // The DEP0190 warning this produces on Node 24 is cosmetic — it does not affect
  // correctness. depcruise is an internal tool invocation, not user-supplied input.
  const ext = process.platform === "win32" ? ".cmd" : "";
  const bin = path.join(repoRoot, "node_modules", ".bin", `depcruise${ext}`);

  const result = spawnSync(bin, [
    "--config", configPath,
    "--output-type", outputType,
    "--ts-config", path.join(repoRoot, "tsconfig.json"),
    "--",
    scanScope,
  ], {
    cwd: repoRoot,
    encoding: "utf8",
    shell: true,
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`dependency-cruiser could not be launched: ${result.error.message}`);
  }

  // Exit code 1 means violations found — that is EXPECTED, stdout has the JSON.
  // Only throw when stdout is empty (a genuine execution failure).
  if (result.stdout && result.stdout.length > 0) {
    return result.stdout;
  }

  const stderr = result.stderr ?? "";
  throw new Error(`dependency-cruiser failed with no usable output.\nstderr: ${stderr}`);
}

function resolveGitMarker(repoRoot: string): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    // Check for uncommitted changes
    try {
      execFileSync("git", ["diff", "--quiet"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      execFileSync("git", ["diff", "--cached", "--quiet"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return sha;
    } catch {
      return "working-tree";
    }
  } catch {
    return "working-tree";
  }
}

function resolveScannerVersion(repoRoot: string): string {
  try {
    const pkgPath = path.join(
      repoRoot,
      "node_modules",
      "dependency-cruiser",
      "package.json"
    );
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    return `dependency-cruiser@${pkg.version}`;
  } catch {
    return "dependency-cruiser@unknown";
  }
}
