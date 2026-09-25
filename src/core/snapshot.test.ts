/**
 * Tests for normalizePath, makeViolationId, and normalizeSnapshot.
 */
import { describe, it, expect } from "vitest";
import {
  normalizePath,
  makeViolationId,
  normalizeSnapshot,
} from "./snapshot.js";

const REPO_ROOT = "/repo/root";

describe("normalizePath", () => {
  it("makes absolute paths repo-relative with forward slashes", () => {
    expect(normalizePath("/repo/root/src/index.ts", REPO_ROOT)).toBe(
      "src/index.ts"
    );
  });

  it("makes relative paths repo-relative", () => {
    expect(normalizePath("src/index.ts", REPO_ROOT)).toBe("src/index.ts");
  });

  it("normalizes backslashes to forward slashes", () => {
    // path.resolve handles backslash on all platforms
    const result = normalizePath("src\\cli\\scan.ts", REPO_ROOT);
    expect(result).toBe("src/cli/scan.ts");
  });
});

describe("makeViolationId", () => {
  it("returns <rule>::<from>::<to> without a cycle path", () => {
    const id = makeViolationId("no-db", "src/ui.ts", "src/db.ts");
    expect(id).toBe("no-db::src/ui.ts::src/db.ts");
  });

  it("appends ::cycle::<hash> when a cyclePath is given", () => {
    const id = makeViolationId("no-cycle", "a.ts", "b.ts", ["a.ts", "b.ts"]);
    expect(id).toMatch(/^no-cycle::a\.ts::b\.ts::cycle::[0-9a-f]{8}$/);
  });

  it("produces identical results on two calls with the same inputs (stability)", () => {
    const id1 = makeViolationId("rule-x", "from.ts", "to.ts", [
      "from.ts",
      "to.ts",
    ]);
    const id2 = makeViolationId("rule-x", "from.ts", "to.ts", [
      "from.ts",
      "to.ts",
    ]);
    expect(id1).toBe(id2);
  });

  it("produces the same cycle hash regardless of cycle member order", () => {
    // Both orderings should produce the same ID because members are sorted
    const idAB = makeViolationId("cycle-rule", "a.ts", "b.ts", [
      "a.ts",
      "b.ts",
    ]);
    const idBA = makeViolationId("cycle-rule", "a.ts", "b.ts", [
      "b.ts",
      "a.ts",
    ]);
    expect(idAB).toBe(idBA);
  });

  it("contains ::cycle:: in the suffix when a cyclePath is provided", () => {
    const id = makeViolationId("r", "f.ts", "t.ts", ["f.ts", "t.ts"]);
    expect(id).toContain("::cycle::");
  });
});

describe("normalizeSnapshot", () => {
  const layerMap: Array<{ name: string; glob: string }> = [];

  it("counts multiple couldNotResolve edges as incompleteResolutionCount", () => {
    const raw = {
      modules: [
        {
          source: "/repo/root/src/a.ts",
          dependencies: [
            { resolved: "/repo/root/src/b.ts", couldNotResolve: true },
            { resolved: "/repo/root/src/c.ts", couldNotResolve: true },
            { resolved: "/repo/root/src/d.ts", couldNotResolve: false },
          ],
        },
      ],
      summary: { violations: [] },
    };

    const snap = normalizeSnapshot(
      raw,
      REPO_ROOT,
      "abc123",
      "dep-cruiser@16",
      "working-tree",
      "src",
      layerMap
    );

    expect(snap.incompleteResolutionCount).toBe(2);
  });

  it("normalizes cycle members typed as { name: string } objects", () => {
    const raw = {
      modules: [
        {
          source: "/repo/root/src/a.ts",
          dependencies: [{ resolved: "/repo/root/src/b.ts" }],
        },
      ],
      summary: {
        violations: [
          {
            rule: { name: "no-cycle", severity: "error" },
            from: "/repo/root/src/a.ts",
            to: "/repo/root/src/b.ts",
            cycle: [{ name: "/repo/root/src/a.ts" }, { name: "/repo/root/src/b.ts" }],
          },
        ],
      },
    };

    const snap = normalizeSnapshot(
      raw,
      REPO_ROOT,
      "abc123",
      "dep-cruiser@16",
      "working-tree",
      "src",
      layerMap
    );

    expect(snap.violations).toHaveLength(1);
    const v = snap.violations[0]!;
    expect(v.cyclePath).not.toBeNull();
    expect(v.cyclePath).toEqual(["src/a.ts", "src/b.ts"]);
    // ID must contain ::cycle::
    expect(v.id).toContain("::cycle::");
  });

  it("sets incompleteResolutionCount to 0 when no unresolved edges", () => {
    const raw = {
      modules: [
        {
          source: "/repo/root/src/a.ts",
          dependencies: [{ resolved: "/repo/root/src/b.ts" }],
        },
      ],
      summary: { violations: [] },
    };

    const snap = normalizeSnapshot(
      raw,
      REPO_ROOT,
      "hash",
      "v1",
      "abc1234",
      "src",
      layerMap
    );

    expect(snap.incompleteResolutionCount).toBe(0);
  });
});
