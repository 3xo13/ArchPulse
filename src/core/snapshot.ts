/**
 * ArchPulse — snapshot normalization helpers (Owner B)
 *
 * Provides:
 *  - normalizePath: convert absolute or backslash paths to repo-relative,
 *    slash-normalized form
 *  - hashConfig: stable SHA-256 of the .dependency-cruiser.cjs file content
 *  - makeViolationId: deterministic "<rule>::<from>::<to>[::cycle]" string
 *  - normalizeSnapshot: convert raw dependency-cruiser JSON to Snapshot
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import * as path from "node:path";

// ─── Schema types (mirror of SCHEMA.md) ──────────────────────────────────────

export interface Module {
  path: string;
  package: string;
  layer?: string;
}

export interface Edge {
  from: string;
  to: string;
  dependencyType: string;
}

export interface Violation {
  id: string;
  rule: string;
  from: string;
  to: string;
  severity: "error" | "warn" | "info";
  cyclePath: string[] | null;
  evidence: string;
}

export interface Snapshot {
  schemaVersion: "1";
  root: string;
  gitMarker: string;
  scannerVersion: string;
  configHash: string;
  timestamp: string;
  modules: Module[];
  edges: Edge[];
  violations: Violation[];
  scannerWarnings: string[];
  incompleteResolutionCount: number;
}

// ─── Path normalization ───────────────────────────────────────────────────────

/**
 * Convert a path to repo-relative, forward-slash form.
 * Absolute paths are made relative to `repoRoot`.
 */
export function normalizePath(filePath: string, repoRoot: string): string {
  const abs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(repoRoot, filePath);
  return path.relative(repoRoot, abs).replace(/\\/g, "/");
}

// ─── Config hash ─────────────────────────────────────────────────────────────

/**
 * Return the SHA-256 hex digest of the given file's content.
 * Used to detect config drift between two snapshots.
 */
export function hashConfig(configPath: string): string {
  const content = readFileSync(configPath, "utf8");
  return createHash("sha256").update(content).digest("hex");
}

// ─── Violation ID ─────────────────────────────────────────────────────────────

/**
 * Build a stable, human-readable violation ID.
 *
 * Format: `<rule>::<from>::<to>`
 * For circular violations, append `::cycle` and sort the cycle members so the
 * ID is deterministic regardless of which module dependency-cruiser starts the
 * cycle report.
 */
export function makeViolationId(
  rule: string,
  from: string,
  to: string,
  cyclePath?: string[] | null
): string {
  const base = `${rule}::${from}::${to}`;
  if (!cyclePath || cyclePath.length === 0) return base;
  const sorted = [...cyclePath].sort().join(",");
  const cycleHash = createHash("sha256").update(sorted).digest("hex").slice(0, 8);
  return `${base}::cycle::${cycleHash}`;
}

// ─── Raw depcruise → Snapshot normalization ───────────────────────────────────

// Minimal typing of the dependency-cruiser JSON output shape.
interface RawDcModule {
  source: string;
  dependencies?: Array<{
    resolved: string;
    couldNotResolve?: boolean;
    dependencyTypes?: string[];
    circular?: boolean;
    cycle?: Array<{ name: string }>;
    rules?: Array<{ name: string; severity: string }>;
  }>;
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

/**
 * Convert raw dependency-cruiser JSON into a normalized Snapshot.
 *
 * @param raw          Parsed dependency-cruiser JSON output
 * @param repoRoot     Absolute path to the repository root (for path normalization)
 * @param configHash   Pre-computed SHA-256 of the config file
 * @param scannerVersion e.g. "dependency-cruiser@16.10.4"
 * @param gitMarker    git commit SHA or "working-tree"
 * @param scanRoot     The scan scope string (stored in snapshot.root)
 * @param layerMap     Map from glob patterns to layer names (from architecture.json)
 */
export function normalizeSnapshot(
  raw: unknown,
  repoRoot: string,
  configHash: string,
  scannerVersion: string,
  gitMarker: string,
  scanRoot: string,
  layerMap: Array<{ name: string; glob: string }>
): Snapshot {
  const dc = raw as RawDcOutput;
  const rawModules = dc.modules ?? [];

  // Build normalized modules (deduplicated)
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

  // Build edges
  const edges: Edge[] = [];
  for (const m of rawModules) {
    const from = normalizePath(m.source, repoRoot);
    for (const dep of m.dependencies ?? []) {
      if (!dep.resolved) continue;
      const to = normalizePath(dep.resolved, repoRoot);
      const depType = dep.dependencyTypes?.[0] ?? "local";
      edges.push({ from, to, dependencyType: depType });
    }
  }

  // Build violations from summary.violations
  const violations: Violation[] = [];
  for (const v of dc.summary?.violations ?? []) {
    const from = normalizePath(v.from, repoRoot);
    const to = normalizePath(v.to, repoRoot);
    const cyclePath = v.cycle
      ? v.cycle.map((c) => normalizePath(c.name, repoRoot))
      : null;
    const id = makeViolationId(v.rule.name, from, to, cyclePath);
    const severity = v.rule.severity as Violation["severity"];
    violations.push({
      id,
      rule: v.rule.name,
      from,
      to,
      severity,
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function inferPackage(normalizedPath: string): string {
  // demo/packages/<name>/... → @demo/<name>
  const m = normalizedPath.match(/^demo\/packages\/([^/]+)\//);
  if (m) return `@demo/${m[1]}`;
  return normalizedPath.split("/").slice(0, 2).join("/");
}

function inferLayer(
  normalizedPath: string,
  layerMap: Array<{ name: string; glob: string }>
): string | undefined {
  for (const { name, glob } of layerMap) {
    // Convert simple glob prefix (e.g. "demo/packages/shared/src/**") to a path prefix test
    const prefix = glob.replace(/\/\*\*$/, "/");
    if (normalizedPath.startsWith(prefix)) return name;
  }
  return undefined;
}

function buildEvidence(
  rule: string,
  from: string,
  to: string,
  cyclePath: string[] | null
): string {
  if (cyclePath && cyclePath.length > 0) {
    return `Circular dependency detected by rule '${rule}': ${cyclePath.join(" → ")}`;
  }
  return `Rule '${rule}' violated: '${from}' imports from '${to}'`;
}
