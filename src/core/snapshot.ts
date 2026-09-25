/**
 * src/core/snapshot.ts
 *
 * Pure utility functions shared by the scanner (Owner B) and the verifier (Owner E).
 *
 * Exports:
 *   normalizePath     — repo-relative, slash-normalized path from an absolute path
 *   computeConfigHash — SHA-256 hex digest of the dependency-cruiser config file
 *   makeViolationId   — stable "<rule>::<from>::<to>" identifier for a violation
 *   makeCycleId       — stable ID for a circular violation (sorted cycle members)
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types (re-exported so consumers can import from one place)
// ---------------------------------------------------------------------------

export interface SnapshotModule {
  path: string;      // repo-relative, slash-normalized
  package: string;   // npm workspace package name, e.g. "@demo/ui"
  layer?: string;    // layer name from config/architecture.json
}

export interface SnapshotEdge {
  from: string;           // repo-relative, slash-normalized
  to: string;             // repo-relative, slash-normalized
  dependencyType: string; // "local" | "workspace" | "npm" | ...
}

export interface SnapshotViolation {
  id: string;                    // stable ID — see makeViolationId / makeCycleId
  rule: string;                  // rule name from .dependency-cruiser.cjs
  from: string;                  // repo-relative, slash-normalized
  to: string;                    // repo-relative, slash-normalized
  severity: "error" | "warn" | "info";
  cyclePath: string[] | null;    // null unless rule is no-circular
  evidence: string;              // human-readable description
}

export interface Snapshot {
  schemaVersion: "1";
  root: string;                  // repo-relative scan root
  gitMarker: string;             // git commit SHA or "working-tree"
  scannerVersion: string;        // e.g. "dependency-cruiser@16.10.4"
  configHash: string;            // SHA-256 of the scanner config file
  timestamp: string;             // ISO 8601
  modules: SnapshotModule[];
  edges: SnapshotEdge[];
  violations: SnapshotViolation[];
  scannerWarnings: string[];
  incompleteResolutionCount: number;
}

// ---------------------------------------------------------------------------
// normalizePath
// ---------------------------------------------------------------------------

/**
 * Convert an absolute (or cwd-relative) file path to a repo-relative,
 * forward-slash-normalized path.
 *
 * @param filePath  - The path to normalize (absolute or relative).
 * @param repoRoot  - Absolute path to the repository root.
 *                    Defaults to process.cwd().
 *
 * @example
 *   normalizePath("D:\\work\\arch_pulse\\demo\\packages\\ui\\src\\orderService.ts",
 *                 "D:\\work\\arch_pulse")
 *   // → "demo/packages/ui/src/orderService.ts"
 */
export function normalizePath(filePath: string, repoRoot?: string): string {
  const root = repoRoot ?? process.cwd();
  const abs = resolve(root, filePath);
  const rel = relative(root, abs);
  // Normalize backslashes to forward slashes (Windows compatibility)
  return rel.replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// computeConfigHash
// ---------------------------------------------------------------------------

/**
 * Read the dependency-cruiser config file at `configPath` and return its
 * SHA-256 hex digest.
 *
 * The hash is stored in every snapshot and checked by the compare tool before
 * diffing two snapshots. If the hashes differ, the comparison is invalid —
 * you would be comparing scans taken under different rule sets.
 *
 * @param configPath - Path to the config file (absolute or relative to cwd).
 *                     Defaults to ".dependency-cruiser.cjs".
 *
 * @example
 *   computeConfigHash()
 *   // → "a3f2c1..." (64-char hex string)
 */
export function computeConfigHash(configPath?: string): string {
  const path = configPath ?? ".dependency-cruiser.cjs";
  const content = readFileSync(resolve(process.cwd(), path));
  return createHash("sha256").update(content).digest("hex");
}

// ---------------------------------------------------------------------------
// makeViolationId
// ---------------------------------------------------------------------------

/**
 * Build a stable, deterministic violation ID for a non-circular rule violation.
 *
 * Format: "<ruleName>::<normalizedFrom>::<normalizedTo>"
 *
 * The ID is stable across scans of unchanged code, allowing the compare tool
 * to match "same violation" between the before- and after-snapshots without
 * relying on array positions or source line numbers.
 *
 * @param rule  - Rule name, e.g. "ui-no-db"
 * @param from  - Repo-relative, slash-normalized source path
 * @param to    - Repo-relative, slash-normalized target path
 *
 * @example
 *   makeViolationId(
 *     "ui-no-db",
 *     "demo/packages/ui/src/orderService.ts",
 *     "demo/packages/db/src/index.ts"
 *   )
 *   // → "ui-no-db::demo/packages/ui/src/orderService.ts::demo/packages/db/src/index.ts"
 */
export function makeViolationId(rule: string, from: string, to: string): string {
  return `${rule}::${from}::${to}`;
}

// ---------------------------------------------------------------------------
// makeCycleId
// ---------------------------------------------------------------------------

/**
 * Build a stable ID for a circular-dependency violation.
 *
 * A cycle may be reported by different edge orderings across scans, so we
 * sort the cycle members before joining to ensure the ID is always the same
 * regardless of which edge the scanner reports first.
 *
 * Format: "no-circular::<sorted-member-1>::<sorted-member-2>::..."
 *
 * @param cycleMembers - Repo-relative, slash-normalized paths forming the cycle.
 *
 * @example
 *   makeCycleId([
 *     "demo/packages/shared/src/index.ts",
 *     "demo/packages/domain/src/index.ts",
 *   ])
 *   // → "no-circular::demo/packages/domain/src/index.ts::demo/packages/shared/src/index.ts"
 */
export function makeCycleId(cycleMembers: string[]): string {
  const sorted = [...cycleMembers].sort();
  return `no-circular::${sorted.join("::")}`;
}
