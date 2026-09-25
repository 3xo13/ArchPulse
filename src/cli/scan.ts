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

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
  // Normalize backslashes so Windows-style paths work with path.resolve
  const repoRoot = (options.repoRoot ?? process.cwd()).replace(/\\/g, "/");
  const configPath = options.configPath
    ? path.resolve(repoRoot, options.configPath.replace(/\\/g, "/"))
    : path.join(repoRoot, ".dependency-cruiser.cjs");

  if (!existsSync(configPath)) {
    throw new Error(`dependency-cruiser config not found: ${configPath}`);
  }

  // Load architecture.json for layers + scan scope
  const archConfigPath = path.join(repoRoot, "config", "architecture.json");
  const archConfig: ArchConfig = existsSync(archConfigPath)
    ? (JSON.parse(readFileSync(archConfigPath, "utf8")) as ArchConfig)
    : {};

  const scanScope = path.resolve(
    repoRoot,
    (options.scanScope ?? archConfig.scanScope ?? "src").replace(/\\/g, "/")
  );
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

  // ── Resolve tsconfig path ──────────────────────────────────────────────────
  const tsconfigPath = path.resolve(repoRoot, "tsconfig.json");

  // ── Run depcruise → JSON ───────────────────────────────────────────────────
  const jsonOutput = runDepcruise(repoRoot, configPath, scanScope, "json", tsconfigPath);

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
  const dotOutput = runDepcruise(repoRoot, configPath, scanScope, "err-html", tsconfigPath);
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
 * Resolve the absolute path to dependency-cruise.mjs bundled with ArchPulse.
 * We walk up from this file's location to find the repo root's node_modules.
 */
function resolveDepcruiseBin(): string {
  // __dirname equivalent for ESM: src/cli/ → ../../node_modules/...
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  // thisDir is <archpulseRoot>/src/cli (or dist/cli after build)
  // walk up two levels to reach <archpulseRoot>
  const archpulseRoot = path.resolve(thisDir, "..", "..");
  return path.join(
    archpulseRoot,
    "node_modules",
    "dependency-cruiser",
    "bin",
    "dependency-cruise.mjs"
  );
}

/**
 * Invoke dependency-cruiser and return stdout as a string.
 * depcruise exits nonzero when violations are found — that is EXPECTED.
 * We only throw on true execution failures (missing binary, bad config).
 */
function runDepcruise(
  repoRoot: string,
  configPath: string,
  scanScope: string,
  outputType: "json" | "err-html",
  tsconfigPath: string
): string {
  const depcruiseBin = resolveDepcruiseBin();

  try {
    const result = execFileSync(
      process.execPath,
      [
        depcruiseBin,
        "--config", configPath,
        "--output-type", outputType,
        "--ts-config", tsconfigPath,
        "--",
        scanScope,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        // depcruise exits 1 when violations exist — NOT a fatal error.
        // We capture stdout regardless of exit code.
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        // Allow large repos
        maxBuffer: 20 * 1024 * 1024,
      }
    );
    return result;
  } catch (err: unknown) {
    // execFileSync throws when exit code ≠ 0.
    // If stdout has content it's a violation-exit (expected). Use it.
    const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    if (execErr.stdout && execErr.stdout.length > 0) {
      return execErr.stdout;
    }
    const stderr = execErr.stderr ?? "";
    throw new Error(
      `dependency-cruiser failed with no usable output.\nstderr: ${stderr}`
    );
  }
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
