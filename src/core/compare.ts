import { readFileSync } from "node:fs";
import * as path from "node:path";
import type { SnapshotViolation } from "./snapshot.js";
import { comparisonSnapshotSchema } from "./validation.js";

export interface CasePacket {
  caseId: string;
  violations: SnapshotViolation[];
}

export interface CompareResult {
  baselineId: string;
  afterId: string;
  resolvedViolations: SnapshotViolation[];
  persistentViolations: SnapshotViolation[];
  newViolations: SnapshotViolation[];
  /** Architecture comparison only: does not assert tests/typechecks passed. */
  status: "verified" | "partial" | "failed" | "invalid";
  reason: string;
}

export function compareSnapshots(beforePath: string, afterPath: string, casePacket: CasePacket): CompareResult {
  const before = loadSnapshot(beforePath);
  const after = loadSnapshot(afterPath);
  const invalid = (reason: string): CompareResult => ({
    baselineId: before.gitMarker, afterId: after.gitMarker,
    resolvedViolations: [], persistentViolations: [], newViolations: [], status: "invalid", reason,
  });
  if (before.configHash !== after.configHash) return invalid("configHash mismatch; rescan with the same configuration.");
  const scopes = [before.root, after.root].map(root => root.replace(/\\/g, "/"));
  if (scopes.some(root => path.posix.isAbsolute(root) || path.win32.isAbsolute(root) || /^[A-Za-z]:/.test(root))) {
    return invalid("Legacy absolute scan scope; rescan to create repository-relative snapshots.");
  }
  const [beforeScope, afterScope] = scopes.map(root => path.posix.normalize(root).replace(/\/$/, "") || ".");
  if (beforeScope !== afterScope) return invalid("Scan scope mismatch; rescan the same scope.");
  if (before.incompleteResolutionCount > 0 || after.incompleteResolutionCount > 0) {
    return invalid("Unresolved dependencies make scan coverage incomplete; fix resolution and rescan.");
  }
  if (!casePacket || !Array.isArray(casePacket.violations) || casePacket.violations.length === 0) {
    return invalid("The selected case must contain baseline violations.");
  }
  const beforeById = new Map(before.violations.map(v => [v.id, v]));
  const afterById = new Map(after.violations.map(v => [v.id, v]));
  if (beforeById.size !== before.violations.length || afterById.size !== after.violations.length) {
    return invalid("Snapshot contains duplicate violation IDs; rescan.");
  }
  const caseIds = new Set(casePacket.violations.map(v => v?.id));
  if ([...caseIds].some(id => !beforeById.has(id))) return invalid("Case violation IDs are missing from the baseline.");
  const resolvedViolations: SnapshotViolation[] = [];
  const persistentViolations: SnapshotViolation[] = [];
  for (const id of caseIds) {
    const original = beforeById.get(id)!;
    const current = afterById.get(id);
    if (current) persistentViolations.push(current);
    else resolvedViolations.push(original);
  }
  const newViolations = after.violations.filter(v => !beforeById.has(v.id));
  const resolved = resolvedViolations.length;
  let status: CompareResult["status"];
  let reason: string;
  if (newViolations.length > 0) {
    status = "failed";
    reason = `${newViolations.length} new violation(s) introduced; ${resolved} of ${caseIds.size} selected violations resolved.`;
  } else if (resolved === caseIds.size) {
    status = "verified";
    reason = `Architecture comparison passed: all ${resolved} selected violations resolved, with no new violations. Tests and typechecking were not run by this comparison.`;
  } else if (resolved > 0) {
    status = "partial";
    reason = `${resolved} of ${caseIds.size} selected violations resolved; ${persistentViolations.length} remain.`;
  } else {
    status = "failed";
    reason = `No selected violations resolved (${caseIds.size} remain).`;
  }
  return { baselineId: before.gitMarker, afterId: after.gitMarker, resolvedViolations,
    persistentViolations, newViolations, status, reason };
}

function loadSnapshot(filePath: string) {
  const absolute = path.resolve(filePath);
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(absolute, "utf8")); }
  catch (error) { throw new Error(`Cannot read snapshot '${absolute}': ${String(error)}`); }
  const parsed = comparisonSnapshotSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid snapshot '${absolute}': ${parsed.error.message}`);
  return parsed.data;
}
