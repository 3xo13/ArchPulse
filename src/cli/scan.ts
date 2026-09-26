import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { format, type ICruiseResult } from "dependency-cruiser";
import { instance } from "@viz-js/viz";
import { normalizeSnapshot } from "../core/snapshot.js";
import { architectureSchema, cruiseResultSchema } from "../core/validation.js";
import { randomUUID } from "node:crypto";
import { assertMutableOutput, digest, internalPath, json, publishFiles, withRepositoryLock } from "../core/storage.js";
import { configurationFingerprint, policyHash, type Manifest } from "../core/provenance.js";
import { runProcess } from "../core/process.js";
import { validateWithinWorkspace } from "../core/workspace.js";

export interface ScanOptions {
  repoRoot?: string;
  outDir?: string;
  configPath?: string;
  scanScope?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  workspaceOnly?: boolean;
}

export interface ScanSummary {
  /** Immutable repository-relative baseline path. */
  baselineId: string;
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
  let repoRoot = path.resolve(slash(options.repoRoot ?? process.cwd()));
  const configPath = path.resolve(repoRoot, slash(options.configPath ?? ".dependency-cruiser.cjs"));
  if (!existsSync(configPath)) throw new Error(`dependency-cruiser config not found: ${configPath}`);

  repoRoot = realpathSync(repoRoot);
  return withRepositoryLock(repoRoot, async () => {
    options.signal?.throwIfAborted();
    const architecturePath = path.join(repoRoot, "config", "architecture.json");
    const architecture = architectureSchema.pick({layers:true,scanScope:true}).partial().parse(existsSync(architecturePath)
      ? JSON.parse(readFileSync(architecturePath, "utf8")) : {});
    const scope = path.resolve(repoRoot, slash(options.scanScope ?? architecture.scanScope ?? "src"));
    validateWithinWorkspace(scope,repoRoot);
    if(options.workspaceOnly)validateWithinWorkspace(configPath,repoRoot);
    const relativeScope = slash(path.relative(repoRoot, scope)) || ".";
    if (path.isAbsolute(relativeScope) || relativeScope === ".." || relativeScope.startsWith("../")) {
      throw new Error("Scan scope must be within the repository root.");
    }
    const outDir = path.resolve(repoRoot, slash(options.outDir ?? ".archpulse/latest"));
    assertMutableOutput(repoRoot,outDir);
    const pkg = JSON.parse(readFileSync(path.join(scannerRoot, "package.json"), "utf8")) as { version: string };
    const raw = await runDepcruise(repoRoot, configPath, scope, options);
    const configHash = configurationFingerprint(raw, repoRoot, relativeScope, pkg.version);
    const snapshot = normalizeSnapshot(raw, repoRoot, configHash,
      `dependency-cruiser@${pkg.version}`, resolveGitMarker(repoRoot), relativeScope, architecture.layers ?? []);

    // Rendering must succeed before either existing artifact is replaced.
    const graphHtml = await generateGraphHtml(raw, repoRoot, options);
    options.signal?.throwIfAborted();
    const id = randomUUID();
    const baselineId = `.archpulse/scans/${id}/snapshot.json`;
    const snapshotJson = json(snapshot);
    const manifest: Manifest = { version: 2, id, repoRoot, configPath, scope: relativeScope,
      fingerprintVersion: 2, configHash, policyHash: policyHash(repoRoot),
      snapshotHash: digest(snapshotJson), graphHash: digest(graphHtml) };
    const changes = new Map<string, string | null>();
    for (const [name, content] of [["snapshot.json", snapshotJson], ["graph.html", graphHtml], ["manifest.json", json(manifest)]]) {
      changes.set(internalPath(repoRoot, "scans", id, name!), content!);
      changes.set(path.join(outDir, name!), content!);
    }
    changes.set(internalPath(repoRoot, "latest-baseline.json"), json({ baselineId }));
    if(options.workspaceOnly)for(const target of changes.keys())validateWithinWorkspace(target,repoRoot);
    publishFiles(changes);
    return {
      baselineId,
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
  }, options.signal);
}

async function runDepcruise(repoRoot: string, configPath: string, scope: string, options: ScanOptions): Promise<ICruiseResult> {
  const args = [path.join(scannerRoot, "bin", "dependency-cruise.mjs"),
    "--config", configPath, "--output-type", "json"];
  const tsconfig = path.join(repoRoot, "tsconfig.json");
  if (existsSync(tsconfig)) args.push("--ts-config", tsconfig);
  args.push("--", scope);
  const result = await runProcess(process.execPath, args, {
    cwd: repoRoot, signal: options.signal, timeoutMs: options.timeoutMs, maxBytes: 20 * 1024 * 1024, maxLines: Infinity,
  });
  if (result.truncated || result.stopped || (result.exitCode !== 0 && result.exitCode !== 1)) {
    throw new Error(`dependency-cruiser execution failed (exit ${result.exitCode}): ${result.stderr}`);
  }
  if (!result.stdout && result.stderr.includes("spawn error")) throw new Error(`dependency-cruiser execution failed: ${result.stderr}`);
  let raw: unknown;
  try { raw = JSON.parse(result.stdout); }
  catch { throw new Error(`dependency-cruiser produced invalid JSON. ${result.stderr}`); }
  const parsed = cruiseResultSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid dependency-cruiser result: ${parsed.error.message}`);
  if (result.exitCode === 1 && !parsed.data.summary.violations.some(v => v.rule.severity === "error")) {
    throw new Error(`dependency-cruiser exited 1 without error violations: ${result.stderr}`);
  }
  return parsed.data as unknown as ICruiseResult;
}

async function generateGraphHtml(raw: ICruiseResult, repoRoot: string, options: ScanOptions): Promise<string> {
  const formatted = await format(raw, { outputType: "dot" });
  if (formatted.exitCode !== 0 || typeof formatted.output !== "string") {
    throw new Error("dependency-cruiser failed to format the dependency graph.");
  }
  let svg: string;
  try { svg = (await instance()).renderString(formatted.output, { format: "svg" }); }
  catch (error) { throw new Error(`Viz.js failed to render the graph: ${String(error)}`); }
  options.signal?.throwIfAborted();
  const wrapped = await runProcess(process.execPath, [path.join(scannerRoot, "bin", "wrap-stream-in-html.mjs")], {
    cwd: repoRoot, input: svg, signal: options.signal, timeoutMs: options.timeoutMs, maxBytes: 20 * 1024 * 1024, maxLines: Infinity,
  });
  if (wrapped.truncated || wrapped.exitCode !== 0 || !wrapped.stdout.includes("<svg")) {
    throw new Error(`HTML graph wrapper failed: ${wrapped.stderr}`);
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
