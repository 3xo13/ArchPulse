/**
 * src/core/snapshot.ts
 *
 * Shared snapshot utilities used by the scanner (Owner B) and the verifier (Owner E).
 *
 * Exports:
 *   normalizePath       — repo-relative, slash-normalized path
 *   computeConfigHash   — SHA-256 of the config file (optional path, defaults to cwd)
 *   hashConfig          — SHA-256 of an explicit config file path (used by scanner)
 *   makeViolationId     — stable "<rule>::<from>::<to>[::cycle::<hash>]" ID
 *   makeCycleId         — stable "no-circular::<sorted-members>" ID (used by compare)
 *   normalizeSnapshot   — convert raw dependency-cruiser JSON → Snapshot
 *
 * Type aliases:
 *   Module / SnapshotModule, Edge / SnapshotEdge, Violation / SnapshotViolation, Snapshot
 *   (both names exported so scanner and verifier can import whichever they already use)
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as nodePath from "node:path";

// ---------------------------------------------------------------------------
// Schema types  (exported under both naming conventions)
// ---------------------------------------------------------------------------

export interface Module {
  path: string;      // repo-relative, slash-normalized
  package: string;   // npm workspace package name, e.g. "@demo/ui"
  layer?: string;    // layer name from config/architecture.json
}
/** Alias kept for consumers that import the longer name. */
export type SnapshotModule = Module;

export interface Edge {
  from: string;           // repo-relative, slash-normalized
  to: string;             // repo-relative, slash-normalized
  dependencyType: string; // "local" | "workspace" | "npm" | ...
}
/** Alias kept for consumers that import the longer name. */
export type SnapshotEdge = Edge;

export interface Violation {
  id: string;                    // stable ID — see makeViolationId / makeCycleId
  rule: string;                  // rule name from .dependency-cruiser.cjs
  from: string;                  // repo-relative, slash-normalized
  to: string;                    // repo-relative, slash-normalized
  severity: "error" | "warn" | "info";
  cyclePath: string[] | null;    // null unless rule is no-circular
  evidence: string;              // human-readable description
}
/** Alias kept for consumers that import the longer name. */
export type SnapshotViolation = Violation;

export interface Snapshot {
  schemaVersion: "1";
  root: string;                  // repo-relative scan root
  gitMarker: string;             // git commit SHA or "working-tree"
  scannerVersion: string;        // e.g. "dependency-cruiser@16.10.4"
  configHash: string;            // SHA-256 of the scanner config file
  timestamp: string;             // ISO 8601
  modules: Module[];
  edges: Edge[];
  violations: Violation[];
  scannerWarnings: string[];
  incompleteResolutionCount: number;
}

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

/**
 * Convert a path to repo-relative, forward-slash form.
 *
 * - When `repoRoot` is provided: resolves relative to it (scanner usage).
 * - When omitted: resolves relative to `process.cwd()` (test/utility usage).
 *
 * @example
 *   normalizePath("D:\\work\\arch_pulse\\demo\\packages\\ui\\src\\orderService.ts",
 *                 "D:\\work\\arch_pulse")
 *   // → "demo/packages/ui/src/orderService.ts"
 */
export function normalizePath(filePath: string, repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();
  const abs = nodePath.isAbsolute(filePath)
    ? filePath
    : nodePath.resolve(root, filePath);
  return nodePath.relative(root, abs).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// Config hash helpers
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex digest of a config file given its explicit absolute path.
 * Used by the scanner (Owner B) which already has the resolved path.
 */
export function hashConfig(configPath: string): string {
  const content = readFileSync(configPath, "utf8");
  return createHash("sha256").update(content).digest("hex");
}

/**
 * SHA-256 hex digest of the dependency-cruiser config file.
 * Path defaults to `.dependency-cruiser.cjs` relative to `process.cwd()`.
 * Used by the verifier (Owner E) and tests.
 */
export function computeConfigHash(configPath?: string): string {
  const resolved = nodePath.resolve(
    process.cwd(),
    configPath ?? ".dependency-cruiser.cjs",
  );
  return hashConfig(resolved);
}

// ---------------------------------------------------------------------------
// Violation ID helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable, deterministic violation ID.
 *
 * Format (non-circular): `<rule>::<from>::<to>`
 * Format (circular):     `<rule>::<from>::<to>::cycle::<8-char hash of sorted cycle>`
 *
 * The cycle hash keeps the ID short while remaining stable regardless of which
 * edge dependency-cruiser reports first.
 */
export function makeViolationId(
  rule: string,
  from: string,
  to: string,
  cyclePath?: string[] | null,
): string {
  const base = `${rule}::${from}::${to}`;
  if (!cyclePath || cyclePath.length === 0) return base;
  const sorted = [...cyclePath].sort().join(",");
  const cycleHash = createHash("sha256").update(sorted).digest("hex").slice(0, 8);
  return `${base}::cycle::${cycleHash}`;
}

/**
 * Build a stable ID for a circular-dependency violation using sorted members.
 * Primarily used by the compare/verifier (Owner E) for cycle matching.
 *
 * Format: `no-circular::<sorted-member-1>::<sorted-member-2>::...`
 */
export function makeCycleId(cycleMembers: string[]): string {
  const sorted = [...cycleMembers].sort();
  return `no-circular::${sorted.join("::")}`;
}

// ---------------------------------------------------------------------------
// Raw dependency-cruiser JSON types
// ---------------------------------------------------------------------------

interface RawDcDependency {
  resolved: string;
  couldNotResolve?: boolean;
  dependencyTypes?: string[];
  circular?: boolean;
  cycle?: Array<{ name: string }>;
  rules?: Array<{ name: string; severity: string }>;
}

interface RawDcModule {
  source: string;
  dependencies?: RawDcDependency[];
  valid?: boolean;
}

interface RawDcOutput {
  modules?: RawDcModule[];
  summary?: {
    violations?: Array<{
      rule: { name: string; severity: string };
      from: string;
      to: string;
      cycle?: Array<{ name: string }>;
    }>;
    warn?: number;
    error?: number;
    info?: number;
    /** Not part of the published API but safe to read if present */
    warnings?: Array<string | { message: string }>;
  };
}

// ---------------------------------------------------------------------------
// normalizeSnapshot
// ---------------------------------------------------------------------------

/**
 * Convert raw dependency-cruiser JSON output into a normalized Snapshot.
 *
 * @param raw            Parsed dependency-cruiser JSON output
 * @param repoRoot       Absolute path to the repository root
 * @param configHash     Pre-computed SHA-256 of the config file
 * @param scannerVersion e.g. "dependency-cruiser@16.10.4"
 * @param gitMarker      Git commit SHA or "working-tree"
 * @param scanRoot       The scan scope string (stored in snapshot.root)
 * @param layerMap       Layer definitions from config/architecture.json
 */
export function normalizeSnapshot(
  raw: unknown,
  repoRoot: string,
  configHash: string,
  scannerVersion: string,
  gitMarker: string,
  scanRoot: string,
  layerMap: Array<{ name: string; glob: string }>,
): Snapshot {
  const dc = raw as RawDcOutput;
  const rawModules = dc.modules ?? [];

  // Modules (deduplicated)
  const seen = new Set<string>();
  const modules: Module[] = [];
  for (const m of rawModules) {
    const p = normalizePath(m.source, repoRoot);
    if (seen.has(p)) continue;
    seen.add(p);
    modules.push({
      path: p,
      package: inferPackage(p),
      layer: inferLayer(p, layerMap),
    });
  }

  // Edges
  const edges: Edge[] = [];
  for (const m of rawModules) {
    const from = normalizePath(m.source, repoRoot);
    for (const dep of m.dependencies ?? []) {
      if (!dep.resolved) continue;
      const to = normalizePath(dep.resolved, repoRoot);
      edges.push({ from, to, dependencyType: dep.dependencyTypes?.[0] ?? "local" });
    }
  }

  // Violations (from summary — authoritative source)
  const violations: Violation[] = [];
  for (const v of dc.summary?.violations ?? []) {
    const from = normalizePath(v.from, repoRoot);
    const to = normalizePath(v.to, repoRoot);
    const cyclePath = v.cycle
      ? v.cycle.map((c) => normalizePath(c.name, repoRoot))
      : null;
    violations.push({
      id: makeViolationId(v.rule.name, from, to, cyclePath),
      rule: v.rule.name,
      from,
      to,
      severity: v.rule.severity as Violation["severity"],
      cyclePath,
      evidence: buildEvidence(v.rule.name, from, to, cyclePath),
    });
  }

  // Count individual dependency edges where depcruise could not resolve the target.
  let incompleteCount = 0;
  for (const m of rawModules) {
    for (const dep of m.dependencies ?? []) {
      if (dep.couldNotResolve === true) incompleteCount++;
    }
  }

  // Populate scannerWarnings from summary.warnings if the field is present.
  const rawWarnings = dc.summary?.warnings ?? [];
  const scannerWarnings: string[] = rawWarnings.map((w) =>
    typeof w === "string" ? w : w.message
  );

  return {
    schemaVersion: "1",
    root: scanRoot,
    gitMarker,
    scannerVersion,
    configHash,
    timestamp: new Date().toISOString(),
    modules,
    edges,
    violations,
    scannerWarnings,
    incompleteResolutionCount: incompleteCount,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function inferPackage(normalizedPath: string): string {
  const m = normalizedPath.match(/^demo\/packages\/([^/]+)\//);
  if (m) return `@demo/${m[1]}`;
  return normalizedPath.split("/").slice(0, 2).join("/");
}

function inferLayer(
  normalizedPath: string,
  layerMap: Array<{ name: string; glob: string }>,
): string | undefined {
  for (const { name, glob } of layerMap) {
    const prefix = glob.replace(/\/\*\*$/, "/");
    if (normalizedPath.startsWith(prefix)) return name;
  }
  return undefined;
}

function buildEvidence(
  rule: string,
  from: string,
  to: string,
  cyclePath: string[] | null,
): string {
  if (cyclePath && cyclePath.length > 0) {
    return `Circular dependency detected by rule '${rule}': ${cyclePath.join(" → ")}`;
  }
  return `Rule '${rule}' violated: '${from}' imports from '${to}'`;
}
