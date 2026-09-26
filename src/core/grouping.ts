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
function shouldMerge(a: SnapshotViolation, b: SnapshotViolation): boolean {
  // Criterion 1: shared cycle path member
  if (a.cyclePath !== null && b.cyclePath !== null) {
    const aSet = new Set(a.cyclePath);
    for (const node of b.cyclePath) {
      if (aSet.has(node)) return true;
    }
  }

  // Criterion 2: shared offending file (from or to)
  const aFiles = new Set([a.from, a.to]);
  if (aFiles.has(b.from) || aFiles.has(b.to)) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Primary-file collection
// ---------------------------------------------------------------------------

function collectFiles(violations: SnapshotViolation[]): string[] {
  const seen = new Set<string>();
  for (const v of violations) {
    seen.add(v.from);
    seen.add(v.to);
  }
  return Array.from(seen).sort();
}

// ---------------------------------------------------------------------------
// Split oversized components
// ---------------------------------------------------------------------------

/**
 * Splits a component whose primary-file count exceeds MAX_PRIMARY_FILES into
 * smaller sub-groups.  The split is deterministic: violations are ordered by
 * their id, then greedily placed into the current sub-group until the file cap
 * would be exceeded, at which point a new sub-group starts.
 *
 * Each sub-group receives the groupKey of every sibling sub-group in its
 * relatedGroups field so consumers can follow the cross-links.
 */
function splitComponent(violations: SnapshotViolation[]): ViolationGroup[] {
  const sorted = [...violations].sort((a, b) => a.id.localeCompare(b.id));
  const subGroups: SnapshotViolation[][] = [];
  let current: SnapshotViolation[] = [];
  let currentFiles = new Set<string>();

  for (const v of sorted) {
    const incoming = [v.from, v.to].filter((f) => !currentFiles.has(f));
    const wouldExceed = currentFiles.size + incoming.length > MAX_PRIMARY_FILES;

    if (current.length > 0 && wouldExceed) {
      subGroups.push(current);
      current = [];
      currentFiles = new Set<string>();
    }
    current.push(v);
    currentFiles.add(v.from);
    currentFiles.add(v.to);
  }
  if (current.length > 0) subGroups.push(current);

  // Build ViolationGroup objects
  const groups: ViolationGroup[] = subGroups.map((viols) => {
    const first = viols[0];
    if (first === undefined) throw new Error("subGroup cannot be empty");
    return {
      groupKey: first.id,
      violations: viols,
      primaryFiles: collectFiles(viols),
    };
  });

  // Wire cross-links between sibling sub-groups
  if (groups.length > 1) {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g === undefined) continue;
      g.relatedGroups = groups
        .filter((_, j) => j !== i)
        .map((sg) => sg.groupKey);
    }
  }

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
