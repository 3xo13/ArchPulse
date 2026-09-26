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
import { configurationFingerprint, policyHash, sourceState, type Manifest } from "../core/provenance.js";
import { runProcess } from "../core/process.js";
import { validateWithinWorkspace } from "../core/workspace.js";
import { projectContext, profile, artifactName, validateArtifact } from "../core/project.js";
import { automaticScan } from "../core/automatic-scan.js";
import { minimatch } from "minimatch";

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
  coverageIncomplete?: boolean;
}

const addonRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const scannerRoot = path.join(addonRoot, "node_modules", "dependency-cruiser");
const slash = (value: string): string => value.replace(/\\/g, "/");

export async function runScan(options: ScanOptions = {}): Promise<ScanSummary> {
  let repoRoot = path.resolve(slash(options.repoRoot ?? process.cwd()));
  const context=projectContext(repoRoot);
  const settings=context?profile(context):undefined;
  const automatic=Boolean(context&&!settings?.adoptedConfig&&!options.configPath);
  const configPath = automatic ? context!.profilePath : path.resolve(repoRoot, slash(options.configPath ?? settings?.adoptedConfig ?? ".dependency-cruiser.cjs"));
  if (!automatic&&!existsSync(configPath)) throw new Error(`dependency-cruiser config not found: ${configPath}`);

  repoRoot = realpathSync(repoRoot);
  return withRepositoryLock(repoRoot, async () => {
    options.signal?.throwIfAborted();
    const architecturePath = path.join(repoRoot, "config", "architecture.json");
    const architecture = architectureSchema.pick({layers:true,scanScope:true}).partial().parse(context ? settings : existsSync(architecturePath)
      ? JSON.parse(readFileSync(architecturePath, "utf8")) : {});
    const scope = path.resolve(repoRoot, slash(options.scanScope ?? architecture.scanScope ?? (context ? "." : "src")));
    validateWithinWorkspace(scope,repoRoot);
    if((options.workspaceOnly||context)&&!automatic)validateWithinWorkspace(configPath,repoRoot);
    const relativeScope = slash(path.relative(repoRoot, scope)) || ".";
    if (path.isAbsolute(relativeScope) || relativeScope === ".." || relativeScope.startsWith("../")) {
      throw new Error("Scan scope must be within the repository root.");
    }
    const outDir = path.resolve(context?.storage ?? repoRoot, slash(options.outDir ?? (context ? "latest" : ".archpulse/latest")));
    assertMutableOutput(repoRoot,outDir);
    const outputs = ["snapshot.json", "graph.html", "manifest.json"].map(name => path.join(outDir, name));
    const state = sourceState(repoRoot, outputs);
    const capturePolicy = context ? policyHash(repoRoot) : undefined;
    const checkCapture = (staged: string[] = []) => {
      options.signal?.throwIfAborted();
      if (state !== sourceState(repoRoot, [...outputs, ...staged]) || (context && capturePolicy !== policyHash(repoRoot))) {
        throw new Error("Source or configuration changed during scan; retry with a stable workspace.");
      }
    };
    const pkg = JSON.parse(readFileSync(path.join(scannerRoot, "package.json"), "utf8")) as { version: string };
    const captured = automatic ? await automaticScan(repoRoot, {signal:options.signal,timeoutMs:options.timeoutMs},relativeScope) : undefined;
    const raw = captured?.raw ?? await runDepcruise(repoRoot, configPath, scope, options);
    const configHash = configurationFingerprint(raw, repoRoot, relativeScope, pkg.version);
    const snapshot = normalizeSnapshot(raw, repoRoot, configHash,
      `dependency-cruiser@${pkg.version}`, resolveGitMarker(repoRoot), relativeScope, architecture.layers ?? []);
    if(captured)for(const module of snapshot.modules){
      const pkg=[...captured.discovery.packages].sort((a,b)=>b.directory.length-a.directory.length).find(p=>p.directory==="."||module.path.startsWith(p.directory+"/"));
      module.package=pkg?.name??"<root>";
      module.layer=architecture.layers?.find(layer=>minimatch(module.path,layer.glob,{dot:true}))?.name;
    }

    // Rendering must succeed before either existing artifact is replaced.
    const graphHtml = await generateGraphHtml(raw, repoRoot, options);
    options.signal?.throwIfAborted();
    const id = randomUUID();
    const baselineId = artifactName(repoRoot,internalPath(repoRoot,"scans",id,"snapshot.json"));
    const snapshotJson = json(snapshot);
    const manifest: Manifest = { version: context ? 3 : 2, id, repoRoot, configPath, scope: relativeScope,
      fingerprintVersion: 2, configHash, policyHash: policyHash(repoRoot),
      snapshotHash: digest(snapshotJson), graphHash: digest(graphHtml),
      ...(context ? {automatic,coverageIncomplete:Boolean(captured?.discovery.unsupported.length||snapshot.scannerWarnings.some(w=>/Ambiguous|PnP|Unsupported dynamic|Unanalyzed source/.test(w))),storageRoot:context.storage} : {}) };
    const changes = new Map<string, string | null>();
    for (const [name, content] of [["snapshot.json", snapshotJson], ["graph.html", graphHtml], ["manifest.json", json(manifest)]]) {
      changes.set(internalPath(repoRoot, "scans", id, name!), content!);
      changes.set(path.join(outDir, name!), content!);
    }
    changes.set(internalPath(repoRoot, "latest-baseline.json"), json({ baselineId }));
    if(captured)changes.set(internalPath(repoRoot,"scans",id,"discovery.json"),json(captured.discovery));
    if(options.workspaceOnly||context)for(const target of changes.keys())validateArtifact(target,repoRoot);
    checkCapture();
    publishFiles(changes, checkCapture);
    return {
      baselineId,
      snapshotPath: artifactName(repoRoot,path.join(outDir, "snapshot.json")),
      graphPath: artifactName(repoRoot,path.join(outDir, "graph.html")),
      violationCount: snapshot.violations.length,
      errorCount: snapshot.violations.filter(v => v.severity === "error").length,
      warnCount: snapshot.violations.filter(v => v.severity === "warn").length,
      violations: snapshot.violations.map(({ id, rule, from, to, severity }) => ({ id, rule, from, to, severity })),
      gitMarker: snapshot.gitMarker,
      configHash,
      incompleteResolutionCount: snapshot.incompleteResolutionCount,
      scannerWarnings: snapshot.scannerWarnings,
      ...(context?{coverageIncomplete:manifest.coverageIncomplete}:{}),
    };
  }, options.signal);
}

async function runDepcruise(repoRoot: string, configPath: string, scope: string, options: ScanOptions): Promise<ICruiseResult> {
  const args = [path.join(scannerRoot, "bin", "dependency-cruise.mjs"),
    "--config", configPath, "--output-type", "json"];
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
  const graphInput=structuredClone(raw);
  delete (graphInput.summary as unknown as Record<string,unknown>).warnings;
  if(graphInput.summary.optionsUsed)for(const key of ["automaticProfile","automaticVersion","typescriptProjects"])delete (graphInput.summary.optionsUsed as Record<string,unknown>)[key];
  const formatted = await format(graphInput, { outputType: "dot" });
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
    const gitOptions = { cwd: repoRoot, env:{...process.env,GIT_OPTIONAL_LOCKS:"0"}, encoding: "utf8" as const, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"] };
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], gitOptions).trim();
    const changed = execFileSync("git", ["status", "--porcelain"], gitOptions).trim();
    return changed ? "working-tree" : sha;
  } catch { return "working-tree"; }
}
