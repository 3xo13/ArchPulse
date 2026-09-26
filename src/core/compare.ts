/**
 * src/core/compare.ts
 *
 * Compare two snapshot JSON files for a specific case neighborhood.
 *
 * Exports:
 *   compareSnapshots  — load before/after snapshots, guard configHash,
 *                       return resolved/persistent/new violation sets.
 *
 * Compare contract (ARCHPULSE_EXECUTION_PLAN.md §4):
 *   - Requires matching configHash values; returns status "invalid" otherwise.
 *   - Scopes resolved/persistent classification to the case's violation IDs.
 *   - Detects newViolations across the FULL after-snapshot so nothing hides.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Snapshot, SnapshotViolation } from "./snapshot.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal case-packet shape needed by compareSnapshots.
 * Matches the CasePacket interface defined in SCHEMA.md.
 */
export interface CasePacket {
  caseId: string;
  violations: SnapshotViolation[];
}

export interface CompareResult {
  /** gitMarker of the before-snapshot */
  baselineId: string;
  /** gitMarker of the after-snapshot */
  afterId: string;
  /** Violations present in before but absent in after (for the case neighborhood) */
  resolvedViolations: SnapshotViolation[];
  /** Violations present in both snapshots (for the case neighborhood) */
  persistentViolations: SnapshotViolation[];
  /**
   * Violations absent in before but present in after.
   * Scanned across the FULL after-snapshot, not just the case neighborhood,
   * so genuinely new rule violations introduced by the refactor are surfaced.
   */
  newViolations: SnapshotViolation[];
  /**
   * "verified"  — case violations resolved, no new violations introduced
   * "partial"   — some case violations resolved but not all
   * "failed"    — no case violations resolved
   * "invalid"   — configHash mismatch; comparison is not meaningful
   */
  status: "verified" | "partial" | "failed" | "invalid";
  reason: string;
}

// ---------------------------------------------------------------------------
// compareSnapshots
// ---------------------------------------------------------------------------

/**
 * Load two snapshot JSON files and compute the violation diff for a case.
 *
 * @param beforePath - Path to the before-snapshot JSON (absolute or cwd-relative).
 * @param afterPath  - Path to the after-snapshot JSON (absolute or cwd-relative).
 * @param casePacket - The case whose violations define the neighborhood to classify.
 *
 * @example
 *   const result = compareSnapshots(
 *     ".archpulse/before/snapshot.json",
 *     ".archpulse/after/snapshot.json",
 *     casePacket,
 *   );
 *   if (result.status === "invalid") { ... }
 */
export function compareSnapshots(
  beforePath: string,
  afterPath: string,
  casePacket: CasePacket,
): CompareResult {
  const before = loadSnapshot(beforePath);
  const after = loadSnapshot(afterPath);

  // Guard: snapshots must have been produced under the same scanner config.
  if (before.configHash !== after.configHash) {
    return {
      baselineId: before.gitMarker,
      afterId: after.gitMarker,
      resolvedViolations: [],
      persistentViolations: [],
      newViolations: [],
      status: "invalid",
      reason:
        `configHash mismatch: before=${before.configHash} after=${after.configHash}. ` +
        "The snapshots were produced under different scanner configurations and cannot be compared.",
    };
  }

  // Build lookup maps keyed by violation ID.
  const beforeById = indexById(before.violations);
  const afterById = indexById(after.violations);

  // Scope resolved/persistent classification to this case's violation IDs.
  const caseIds = new Set(casePacket.violations.map((v) => v.id));

  const resolvedViolations: SnapshotViolation[] = [];
  const persistentViolations: SnapshotViolation[] = [];

  for (const id of caseIds) {
    const inBefore = beforeById.has(id);
    const inAfter = afterById.has(id);

    if (inBefore && !inAfter) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      resolvedViolations.push(beforeById.get(id)!);
    } else if (inBefore && inAfter) {
      // Use the after object — most current evidence.
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      persistentViolations.push(afterById.get(id)!);
    }
    // If the ID was in the case but never in before (data anomaly), ignore.
  }

  // New violations: present in after but absent in before — full snapshot scope.
  const newViolations: SnapshotViolation[] = [];
  for (const [id, violation] of afterById) {
    if (!beforeById.has(id)) {
      newViolations.push(violation);
    }
  }

  // Derive status.
  const totalCase = caseIds.size;
  const resolvedCount = resolvedViolations.length;

  let status: CompareResult["status"];
  let reason: string;

  if (resolvedCount === totalCase && totalCase > 0) {
    status = "verified";
    reason = `All ${resolvedCount} case violation(s) resolved.`;
  } else if (resolvedCount > 0) {
    status = "partial";
    reason =
      `${resolvedCount} of ${totalCase} case violation(s) resolved; ` +
      `${persistentViolations.length} remain.`;
  } else {
    status = "failed";
    reason = `No case violations were resolved (${totalCase} remain).`;
  }

  return {
    baselineId: before.gitMarker,
    afterId: after.gitMarker,
    resolvedViolations,
    persistentViolations,
    newViolations,
    status,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadSnapshot(filePath: string): Snapshot {
  const abs = resolve(process.cwd(), filePath);
  const raw = readFileSync(abs, "utf-8");
  return JSON.parse(raw) as Snapshot;
}

function indexById(
  violations: SnapshotViolation[],
): Map<string, SnapshotViolation> {
  const map = new Map<string, SnapshotViolation>();
  for (const v of violations) {
    map.set(v.id, v);
  }
  return map;
}
