import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { format, type ICruiseResult } from "dependency-cruiser";
import { instance } from "@viz-js/viz";
import { hashConfig, normalizeSnapshot } from "../core/snapshot.js";
import { cruiseResultSchema } from "../core/validation.js";
import { publishArtifacts } from "../core/artifacts.js";

export interface ScanOptions {
  repoRoot?: string;
  outDir?: string;
  configPath?: string;
  scanScope?: string;
}

export interface ScanSummary {
  /** Repo-relative unless a CLI output path is on another Windows drive. */
  snapshotPath: string;
  graphPath: string;
  violationCount: number;
  errorCount: number;
  warnCount: number;
  violations: Array<{ id: string; rule: string; from: string; to: string; severity: string }>;
  gitMarker: string;
  configHash: string;
  incompleteResolutionCount: number;
  scannerWarnings: string[];
}

const addonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scannerRoot = path.join(addonRoot, "node_modules", "dependency-cruiser");
const slash = (value: string): string => value.replace(/\\/g, "/");

export async function runScan(options: ScanOptions = {}): Promise<ScanSummary> {
  const repoRoot = path.resolve(slash(options.repoRoot ?? process.cwd()));
  const configPath = path.resolve(repoRoot, slash(options.configPath ?? ".dependency-cruiser.cjs"));
  if (!existsSync(configPath)) throw new Error(`dependency-cruiser config not found: ${configPath}`);

  const architecturePath = path.join(repoRoot, "config", "architecture.json");
  const architecture = (existsSync(architecturePath)
    ? JSON.parse(readFileSync(architecturePath, "utf8")) : {}) as {
      layers?: Array<{ name: string; glob: string }>;
      scanScope?: string;
    };
  const scope = path.resolve(repoRoot, slash(options.scanScope ?? architecture.scanScope ?? "src"));
  const relativeScope = slash(path.relative(repoRoot, scope)) || ".";
  if (path.isAbsolute(relativeScope) || relativeScope === ".." || relativeScope.startsWith("../")) {
    throw new Error("Scan scope must be within the repository root.");
  }
  const outDir = path.resolve(repoRoot, slash(options.outDir ?? ".archpulse/latest"));
  const configHash = hashConfig(configPath);
  const pkg = JSON.parse(readFileSync(path.join(scannerRoot, "package.json"), "utf8")) as { version: string };
  const raw = runDepcruise(repoRoot, configPath, scope);
  const snapshot = normalizeSnapshot(raw, repoRoot, configHash,
    `dependency-cruiser@${pkg.version}`, resolveGitMarker(repoRoot), relativeScope, architecture.layers ?? []);

  // Rendering must succeed before either existing artifact is replaced.
  const graphHtml = await generateGraphHtml(raw);
  publishArtifacts(outDir, JSON.stringify(snapshot, null, 2), graphHtml);
  return {
    snapshotPath: slash(path.relative(repoRoot, path.join(outDir, "snapshot.json"))),
    graphPath: slash(path.relative(repoRoot, path.join(outDir, "graph.html"))),
    violationCount: snapshot.violations.length,
    errorCount: snapshot.violations.filter(v => v.severity === "error").length,
    warnCount: snapshot.violations.filter(v => v.severity === "warn").length,
    violations: snapshot.violations.map(({ id, rule, from, to, severity }) => ({ id, rule, from, to, severity })),
    gitMarker: snapshot.gitMarker,
    configHash,
    incompleteResolutionCount: snapshot.incompleteResolutionCount,
    scannerWarnings: snapshot.scannerWarnings,
  };
}

function runDepcruise(repoRoot: string, configPath: string, scope: string): ICruiseResult {
  const args = [path.join(scannerRoot, "bin", "dependency-cruise.mjs"),
    "--config", configPath, "--output-type", "json"];
  const tsconfig = path.join(repoRoot, "tsconfig.json");
  if (existsSync(tsconfig)) args.push("--ts-config", tsconfig);
  args.push("--", scope);
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot, encoding: "utf8", shell: false, maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error || result.signal || (result.status !== 0 && result.status !== 1)) {
    throw new Error(`dependency-cruiser execution failed (exit ${result.status}): ${result.error?.message ?? result.stderr}`);
  }
  let raw: unknown;
  try { raw = JSON.parse(result.stdout); }
  catch { throw new Error(`dependency-cruiser produced invalid JSON. ${result.stderr}`); }
  const parsed = cruiseResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid dependency-cruiser result: ${parsed.error.message}`);
  if (result.status === 1 && !parsed.data.summary.violations.some(v => v.rule.severity === "error")) {
    throw new Error(`dependency-cruiser exited 1 without error violations: ${result.stderr}`);
  }
  return parsed.data as unknown as ICruiseResult;
}

async function generateGraphHtml(raw: ICruiseResult): Promise<string> {
  const formatted = await format(raw, { outputType: "dot" });
  if (formatted.exitCode !== 0 || typeof formatted.output !== "string") {
    throw new Error("dependency-cruiser failed to format the dependency graph.");
  }
  let svg: string;
  try { svg = (await instance()).renderString(formatted.output, { format: "svg" }); }
  catch (error) { throw new Error(`Viz.js failed to render the graph: ${String(error)}`); }
  const wrapped = spawnSync(process.execPath, [path.join(scannerRoot, "bin", "wrap-stream-in-html.mjs")], {
    input: svg, encoding: "utf8", shell: false, maxBuffer: 20 * 1024 * 1024,
  });
  if (wrapped.error || wrapped.status !== 0 || !wrapped.stdout.includes("<svg")) {
    throw new Error(`HTML graph wrapper failed: ${wrapped.error?.message ?? wrapped.stderr}`);
  }
  return wrapped.stdout;
}

function resolveGitMarker(repoRoot: string): string {
  try {
    const gitOptions = { cwd: repoRoot, encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], gitOptions).trim();
    const changed = execFileSync("git", ["status", "--porcelain"], gitOptions).trim();
    return changed ? "working-tree" : sha;
  } catch { return "working-tree"; }
}
