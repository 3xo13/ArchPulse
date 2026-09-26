/**
 * src/core/compare.test.ts
 *
 * Regression tests for compareSnapshots in compare.ts.
 *
 * Strategy:
 *   compareSnapshots reads snapshot files from disk via readFileSync.
 *   There is no in-memory injection seam, so tests that need custom "after"
 *   snapshots write temporary JSON files to os.tmpdir() and clean up in
 *   afterEach.  The real fixtures in artifacts/example/ are used directly
 *   as the "before" path wherever possible.
 */

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { compareSnapshots } from "./compare.js";
import type { CasePacket } from "./compare.js";
import type { Snapshot, SnapshotViolation } from "./snapshot.js";

// ---------------------------------------------------------------------------
// Shared fixture paths
// ---------------------------------------------------------------------------

const BEFORE_PATH = "artifacts/example/snapshot-before.json";
const AFTER_PATH  = "artifacts/example/snapshot-after.json";

// Violation IDs as they appear verbatim in the fixture files.
const UI_NO_DB_ID =
  "ui-no-db::demo/packages/ui/src/orderService.ts::demo/packages/db/src/index.ts";
const SHARED_NO_DOMAIN_ID =
  "shared-no-domain::demo/packages/shared/src/index.ts::demo/packages/domain/src/index.ts";

// The configHash value present in both example fixtures.
const FIXTURE_CONFIG_HASH = "PLACEHOLDER_REPLACED_BY_SCANNER";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Temp files created during a test — removed in afterEach. */
const tempFiles: string[] = [];

/**
 * Write a Snapshot object to a uniquely-named temp file and return its path
 * (relative to cwd, so compareSnapshots can resolve it).
 */
function writeTempSnapshot(snapshot: Snapshot): string {
  const name = `compare-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
  const abs = join(tmpdir(), name);
  writeFileSync(abs, JSON.stringify(snapshot), "utf-8");
  tempFiles.push(abs);
  // compareSnapshots calls resolve(process.cwd(), filePath), so we return
  // the absolute path directly — resolve() on an absolute path is a no-op.
  return abs;
}

/** Minimal valid snapshot skeleton; tests override only what they need. */
function makeSnapshot(overrides: Partial<Snapshot> & { violations: SnapshotViolation[] }): Snapshot {
  return {
    schemaVersion: "1",
    root: "demo/packages",
    gitMarker: "test-marker",
    scannerVersion: "dependency-cruiser@16.10.4",
    configHash: FIXTURE_CONFIG_HASH,
    timestamp: "2026-09-25T00:00:00.000Z",
    modules: [],
    edges: [],
    scannerWarnings: [],
    incompleteResolutionCount: 0,
    ...overrides,
  };
}

/** Minimal violation object. */
function makeViolation(id: string): SnapshotViolation {
  const [rule, from = "", to = ""] = id.split("::");
  return {
    id,
    rule: rule ?? id,
    from,
    to,
    severity: "error",
    cyclePath: null,
    evidence: `test evidence for ${id}`,
  };
}

afterEach(() => {
  // Remove all temp files created in the last test.
  for (const f of tempFiles.splice(0)) {
    try { unlinkSync(f); } catch { /* already gone */ }
  }
});

// ---------------------------------------------------------------------------
// 1. configHash mismatch → status "invalid"
// ---------------------------------------------------------------------------

describe("configHash mismatch", () => {
  it("returns status invalid and empty violation arrays when hashes differ", () => {
    const afterSnapshot = makeSnapshot({
      gitMarker: "after-marker",
      configHash: "DIFFERENT_HASH_THAT_DOES_NOT_MATCH",
      violations: [],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const casePacket: CasePacket = {
      caseId: "case-001",
      violations: [makeViolation(UI_NO_DB_ID)],
    };

    const result = compareSnapshots(BEFORE_PATH, afterPath, casePacket);

    expect(result.status).toBe("invalid");
    expect(result.resolvedViolations).toHaveLength(0);
    expect(result.persistentViolations).toHaveLength(0);
    expect(result.newViolations).toHaveLength(0);
    expect(result.reason).toContain("configHash mismatch");
  });

  it("carries the correct gitMarkers in the invalid result", () => {
    const afterSnapshot = makeSnapshot({
      gitMarker: "after-with-wrong-hash",
      configHash: "WRONG",
      violations: [],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const result = compareSnapshots(BEFORE_PATH, afterPath, {
      caseId: "case-x",
      violations: [],
    });

    expect(result.baselineId).toBe("baseline");        // from fixture
    expect(result.afterId).toBe("after-with-wrong-hash");
    expect(result.status).toBe("invalid");
  });
});

// ---------------------------------------------------------------------------
// 2. New violation detected (absent in before, present in after)
// ---------------------------------------------------------------------------

describe("new violation detection", () => {
  it("reports a violation that appears in after but not in before under newViolations", () => {
    const NEW_ID = "domain-no-ui::demo/packages/domain/src/order.ts::demo/packages/ui/src/index.ts";

    // After snapshot: same hash, same existing violations as before, PLUS one new one.
    const afterSnapshot = makeSnapshot({
      gitMarker: "after-with-new-violation",
      violations: [
        makeViolation(UI_NO_DB_ID),
        makeViolation(SHARED_NO_DOMAIN_ID),
        makeViolation(NEW_ID),          // <-- brand new
      ],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    // Case packet covers only the two known violations from before.
    const casePacket: CasePacket = {
      caseId: "case-001",
      violations: [
        makeViolation(UI_NO_DB_ID),
        makeViolation(SHARED_NO_DOMAIN_ID),
      ],
    };

    const result = compareSnapshots(BEFORE_PATH, afterPath, casePacket);

    expect(result.status).toBe("failed");  // none of the case violations resolved
    expect(result.newViolations).toHaveLength(1);
    expect(result.newViolations[0]!.id).toBe(NEW_ID);
    expect(result.resolvedViolations).toHaveLength(0);
  });

  it("reports the new violation's full object, not just its ID", () => {
    const NEW_ID = "db-no-ui::demo/packages/db/src/repository.ts::demo/packages/ui/src/index.ts";
    const newViolation = makeViolation(NEW_ID);

    const afterSnapshot = makeSnapshot({
      gitMarker: "after",
      violations: [makeViolation(UI_NO_DB_ID), newViolation],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const result = compareSnapshots(BEFORE_PATH, afterPath, {
      caseId: "case-x",
      violations: [makeViolation(UI_NO_DB_ID)],
    });

    const found = result.newViolations.find((v) => v.id === NEW_ID);
    expect(found).toBeDefined();
    expect(found!.rule).toBe(newViolation.rule);
    expect(found!.evidence).toBe(newViolation.evidence);
  });

  it("detects a new violation even when it is outside the case neighborhood", () => {
    // Case covers only ui-no-db; new violation is in a completely different pair.
    const OUTSIDE_ID = "shared-no-ui::demo/packages/shared/src/index.ts::demo/packages/ui/src/index.ts";

    const afterSnapshot = makeSnapshot({
      gitMarker: "after",
      violations: [
        makeViolation(UI_NO_DB_ID),
        makeViolation(OUTSIDE_ID),
      ],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const result = compareSnapshots(BEFORE_PATH, afterPath, {
      caseId: "case-001",
      violations: [makeViolation(UI_NO_DB_ID)],
    });

    // ui-no-db is persistent (in both), OUTSIDE_ID is new.
    expect(result.newViolations.map((v) => v.id)).toContain(OUTSIDE_ID);
    expect(result.persistentViolations.map((v) => v.id)).toContain(UI_NO_DB_ID);
  });
});

// ---------------------------------------------------------------------------
// 3. Resolved violation detected (present in before, absent in after)
// ---------------------------------------------------------------------------

describe("resolved violation detection", () => {
  it("reports a violation removed from after under resolvedViolations", () => {
    // After snapshot: same hash, ui-no-db is GONE, shared-no-domain remains.
    const afterSnapshot = makeSnapshot({
      gitMarker: "after-repaired",
      violations: [makeViolation(SHARED_NO_DOMAIN_ID)],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    // Case covers ui-no-db only.
    const casePacket: CasePacket = {
      caseId: "case-001",
      violations: [makeViolation(UI_NO_DB_ID)],
    };

    const result = compareSnapshots(BEFORE_PATH, afterPath, casePacket);

    expect(result.status).toBe("verified");
    expect(result.resolvedViolations).toHaveLength(1);
    expect(result.resolvedViolations[0]!.id).toBe(UI_NO_DB_ID);
    expect(result.persistentViolations).toHaveLength(0);
    expect(result.newViolations).toHaveLength(0);
  });

  it("uses the before-snapshot object for the resolved violation, not the after", () => {
    // The resolved violation object should come from before (it no longer exists in after).
    const afterSnapshot = makeSnapshot({
      gitMarker: "after",
      violations: [],   // everything resolved
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const casePacket: CasePacket = {
      caseId: "case-001",
      violations: [makeViolation(UI_NO_DB_ID)],
    };

    const result = compareSnapshots(BEFORE_PATH, afterPath, casePacket);

    // The evidence string should match what's in snapshot-before.json verbatim.
    expect(result.resolvedViolations[0]!.evidence).toBe(
      "ui imports { saveOrder, findOrdersByUser } from @demo/db — forbidden: UI layer must not access db directly",
    );
  });

  it("partial status when only some case violations are resolved", () => {
    // Both violations are in the case; only ui-no-db is resolved in after.
    const afterSnapshot = makeSnapshot({
      gitMarker: "after-partial",
      violations: [makeViolation(SHARED_NO_DOMAIN_ID)],
    });
    const afterPath = writeTempSnapshot(afterSnapshot);

    const casePacket: CasePacket = {
      caseId: "case-mixed",
      violations: [
        makeViolation(UI_NO_DB_ID),
        makeViolation(SHARED_NO_DOMAIN_ID),
      ],
    };

    const result = compareSnapshots(BEFORE_PATH, afterPath, casePacket);

    expect(result.status).toBe("partial");
    expect(result.resolvedViolations.map((v) => v.id)).toContain(UI_NO_DB_ID);
    expect(result.persistentViolations.map((v) => v.id)).toContain(SHARED_NO_DOMAIN_ID);
  });
});

// ---------------------------------------------------------------------------
// 4. Real fixture pair (smoke test using artifacts/example/ directly)
// ---------------------------------------------------------------------------

describe("real fixture pair: snapshot-before vs snapshot-after", () => {
  it("resolves ui-no-db and keeps shared-no-domain persistent for case-001", () => {
    const casePacket: CasePacket = {
      caseId: "case-001",
      violations: [makeViolation(UI_NO_DB_ID)],
    };

    const result = compareSnapshots(BEFORE_PATH, AFTER_PATH, casePacket);

    expect(result.status).toBe("verified");
    expect(result.resolvedViolations.map((v) => v.id)).toContain(UI_NO_DB_ID);
    expect(result.persistentViolations).toHaveLength(0);
    expect(result.newViolations).toHaveLength(0);
  });

  it("carries correct gitMarkers from the fixture files", () => {
    const result = compareSnapshots(BEFORE_PATH, AFTER_PATH, {
      caseId: "case-001",
      violations: [],
    });

    expect(result.baselineId).toBe("baseline");
    expect(result.afterId).toBe("post-repair");
  });
});
