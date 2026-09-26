/**
 * grouping.ts — Owner C
 *
 * Pure, deterministic grouping of snapshot violations into bounded case groups.
 * No I/O. No side effects.
 *
 * NOTE: The Snapshot / Violation / Module types below are local minimal
 * definitions derived from SCHEMA.md.  Once Owner B publishes src/core/snapshot.ts
 * these can be replaced with a re-export from that module without changing the
 * grouping logic.
 */

// ---------------------------------------------------------------------------
// Minimal local type aliases (replace with Owner B's shared types when ready)
// ---------------------------------------------------------------------------

export interface SnapshotViolation {
  id: string;
  rule: string;
  from: string;
  to: string;
  severity: "error" | "warn" | "info";
  cyclePath: string[] | null;
  evidence: string;
}

export interface SnapshotInput {
  schemaVersion: string;
  gitMarker: string;
  violations: SnapshotViolation[];
  /** Optional – used to infer layer / package context if available */
  modules?: Array<{ path: string; package: string; layer?: string }>;
}

// ---------------------------------------------------------------------------
// Public output type
// ---------------------------------------------------------------------------

export interface ViolationGroup {
  /** Lex-smallest violation.id in the group — stable sort / ID key */
  groupKey: string;
  violations: SnapshotViolation[];
  /** ≤6 deduplicated, sorted repo-relative paths */
  primaryFiles: string[];
  /** Populated when a large component was split; names sibling group keys */
  relatedGroups?: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PRIMARY_FILES = 6;

// ---------------------------------------------------------------------------
// Union-Find helpers
// ---------------------------------------------------------------------------

function makeUF(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function find(uf: number[], x: number): number {
  while (uf[x] !== x) {
    // noUncheckedIndexedAccess: assert presence since x is always a valid index
    const parent = uf[x] as number;
    const grandparent = uf[parent] as number;
    uf[x] = grandparent; // path compression (halving)
    x = parent;
  }
  return x;
}

function union(uf: number[], a: number, b: number): void {
  const ra = find(uf, a);
  const rb = find(uf, b);
  if (ra !== rb) uf[ra] = rb;
}

// ---------------------------------------------------------------------------
// Grouping criteria
// ---------------------------------------------------------------------------

/**
 * Returns true when two violations should be merged into the same case.
 *
 * Criteria (any one is sufficient):
 *   1. Shared cycle path member — both have cyclePath arrays that share ≥1 file.
 *   2. Shared offending file — any of {from, to} in one violation matches any
 *      of {from, to} in the other.
 *
 * Explicitly NOT a criterion: same rule name.
 * Same-rule violations can represent entirely unrelated architectural problems
 * and must remain in separate cases unless they also satisfy criteria 1 or 2.
 */
function filesOf(v: SnapshotViolation): string[] {
  return [...new Set([v.from, v.to, ...(v.cyclePath ?? [])])].sort();
}
function shouldMerge(a: SnapshotViolation, b: SnapshotViolation): boolean {
  const files = new Set(filesOf(a));
  return filesOf(b).some(file => files.has(file));
}
function collectFiles(violations: SnapshotViolation[]): string[] {
  return [...new Set(violations.flatMap(filesOf))].sort();
}
function splitComponent(violations: SnapshotViolation[]): ViolationGroup[] {
  const sorted = [...violations].sort((a,b) => a.id.localeCompare(b.id));
  const groups: ViolationGroup[] = [];
  let current: SnapshotViolation[] = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({ groupKey: current[0]!.id, violations: current, primaryFiles: collectFiles(current) });
    current = [];
  };
  for (const violation of sorted) {
    const files = filesOf(violation);
    if (files.length > MAX_PRIMARY_FILES) {
      flush();
      for (let i = 0; i < files.length; i += MAX_PRIMARY_FILES) {
        groups.push({ groupKey: `${violation.id}::part-${i / MAX_PRIMARY_FILES + 1}`,
          violations: [violation], primaryFiles: files.slice(i, i + MAX_PRIMARY_FILES) });
      }
    } else {
      if (collectFiles([...current, violation]).length > MAX_PRIMARY_FILES) flush();
      current.push(violation);
    }
  }
  flush();
  if (groups.length > 1) for (const group of groups) group.relatedGroups = groups.filter(other => other !== group).map(other => other.groupKey);
  return groups;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Groups violations in `snapshot` into bounded, reviewable case groups.
 *
 * The returned array is ordered by groupKey (lex-smallest violation.id in
 * each group), making the ordering deterministic across re-runs on the same
 * snapshot.
 */
export function groupViolations(snapshot: SnapshotInput): ViolationGroup[] {
  const { violations } = snapshot;
  if (violations.length === 0) return [];

  const n = violations.length;
  const uf = makeUF(n);

  // Build connected components via union-find
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const vi = violations[i];
      const vj = violations[j];
      if (vi !== undefined && vj !== undefined && shouldMerge(vi, vj)) {
        union(uf, i, j);
      }
    }
  }

  // Collect members per root representative
  const components = new Map<number, SnapshotViolation[]>();
  for (let i = 0; i < n; i++) {
    const vi = violations[i];
    if (vi === undefined) continue;
    const root = find(uf, i);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(vi);
  }

  // Build groups, splitting oversized components
  const groups: ViolationGroup[] = [];
  for (const viols of components.values()) {
    const files = collectFiles(viols);
    if (files.length <= MAX_PRIMARY_FILES) {
      const sortedViols = [...viols].sort((a, b) => a.id.localeCompare(b.id));
      const first = sortedViols[0];
      if (first === undefined) continue;
      groups.push({
        groupKey: first.id,
        violations: sortedViols,
        primaryFiles: files,
      });
    } else {
      groups.push(...splitComponent(viols));
    }
  }

  // Sort the final list by groupKey for deterministic output ordering
  groups.sort((a, b) => a.groupKey.localeCompare(b.groupKey));
  return groups;
}
