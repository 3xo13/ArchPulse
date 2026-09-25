/**
 * ArchPulse — scan runner (Owner B)
 *
 * Invokes dependency-cruiser programmatically:
 *  1. Runs `--output-type json` to get machine-readable violations.
 *  2. Reuses the raw JSON result to produce a DOT string via format().
 *  3. Renders DOT → SVG with @viz-js/viz (no system Graphviz required).
 *  4. Pipes SVG through wrap-stream-in-html.mjs to get interactive HTML.
 *  5. Normalizes the JSON into a Snapshot and writes snapshot.json + graph.html.
 *  6. Returns a compact ScanSummary for MCP / CLI consumers.
 *
 * Key constraint: depcruise exits nonzero when violations are found.
 * We distinguish that expected case (valid JSON output) from a real
 * execution error (no usable output).
 */

import { execFileSync, spawnSync } from "node:child_process";
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
  const jsonOutput = runDepcruise(repoRoot, configPath, scanScope, tsconfigPath);

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

  // ── Generate graph.html from rawJson (no second depcruise invocation) ──────
  const graphPath = path.join(outDir, "graph.html");
  const graphHtml = await generateGraphHtml(rawJson);
  writeFileSync(graphPath, graphHtml, "utf8");

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
 * Resolve ArchPulse's own node_modules root from this file's location.
 * Works both from src/cli/ (tsx) and dist/cli/ (compiled).
 */
function resolveArchpulseRoot(): string {
  const thisDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(thisDir, "..", "..");
}

/**
 * Resolve the absolute path to dependency-cruise.mjs bundled with ArchPulse.
 */
function resolveDepcruiseBin(): string {
  return path.join(
    resolveArchpulseRoot(),
    "node_modules",
    "dependency-cruiser",
    "bin",
    "dependency-cruise.mjs"
  );
}

/**
 * Invoke dependency-cruiser for JSON output and return stdout as a string.
 * depcruise exits nonzero when violations are found — that is EXPECTED.
 * We only throw on true execution failures (missing binary, bad config).
 */
function runDepcruise(
  repoRoot: string,
  configPath: string,
  scanScope: string,
  tsconfigPath: string
): string {
  const depcruiseBin = resolveDepcruiseBin();

  try {
    const result = execFileSync(
      process.execPath,
      [
        depcruiseBin,
        "--config", configPath,
        "--output-type", "json",
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

/**
 * Generate interactive graph HTML from a raw depcruise JSON result.
 *
 * Steps:
 *  1. Format the cruise result as DOT using dependency-cruiser's JS API.
 *  2. Render DOT → SVG with @viz-js/viz (bundled WASM; no system Graphviz).
 *  3. Pipe SVG through wrap-stream-in-html.mjs via process.execPath to get
 *     the interactive HTML (with dep-cruiser's stylesheet + script).
 */
async function generateGraphHtml(rawJson: unknown): Promise<string> {
  const archpulseRoot = resolveArchpulseRoot();

  // ── Step 1: DOT string from depcruise format() ────────────────────────────
  const dcMainPath = path.join(
    archpulseRoot,
    "node_modules",
    "dependency-cruiser",
    "src",
    "main",
    "index.mjs"
  );
  const { format } = (await import(dcMainPath)) as {
    format: (result: unknown, opts: { outputType: string }) => Promise<{ output: string; exitCode: number }>;
  };
  const { output: dot } = await format(rawJson, { outputType: "dot" });

  // ── Step 2: SVG from @viz-js/viz ──────────────────────────────────────────
  const { instance } = (await import("@viz-js/viz")) as {
    instance: () => Promise<{ renderString: (dot: string) => string }>;
  };
  let svg: string;
  try {
    const viz = await instance();
    svg = viz.renderString(dot);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Viz.js failed to render the dependency graph DOT string: ${msg}`);
  }

  // ── Step 3: HTML via wrap-stream-in-html.mjs ──────────────────────────────
  const wrapBin = path.join(
    archpulseRoot,
    "node_modules",
    "dependency-cruiser",
    "bin",
    "wrap-stream-in-html.mjs"
  );
  const wrapResult = spawnSync(
    process.execPath,
    [wrapBin],
    {
      input: svg,
      encoding: "utf8",
      shell: false,
      maxBuffer: 20 * 1024 * 1024,
    }
  );
  if (wrapResult.status !== 0 || !wrapResult.stdout) {
    const stderr = wrapResult.stderr ?? "";
    throw new Error(
      `wrap-stream-in-html.mjs failed (exit ${wrapResult.status ?? "null"}).\nstderr: ${stderr}`
    );
  }

  return wrapResult.stdout;
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
