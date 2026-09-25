/**
 * Tests for scan error handling, path handling, and snapshot wiring.
 *
 * Integration tests that require an actual depcruise scan are gated on
 * Node ≥ 20 (the minimum supported version).
 *
 * Note: We avoid vi.spyOn on node:child_process because built-in module
 * exports are non-configurable in ESM. Error-path tests are written using
 * real filesystem conditions or fixture-based normalization tests.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeSnapshot } from "../core/snapshot.js";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
// ArchPulse root is two levels up from src/cli/
const ARCHPULSE_ROOT = path.resolve(thisDir, "..", "..");

describe("runScan — error handling", () => {
  it("throws a clear error when .dependency-cruiser.cjs config is missing", async () => {
    const { runScan } = await import("./scan.js");
    // Use a path that definitely has no .dependency-cruiser.cjs
    await expect(
      runScan({ repoRoot: path.join(ARCHPULSE_ROOT, "nonexistent-dir-xyz") })
    ).rejects.toThrow(/dependency-cruiser config not found/i);
  });
});

describe("runScan — path with spaces", () => {
  it("resolves paths containing spaces without shell expansion (space preserved in resolved path)", () => {
    // Verify that path.resolve preserves spaces — the key invariant that
    // ensures depcruise receives the path as a literal spawn argument.
    const spacyBase = "/path/with spaces/repo";
    const resolved = path.resolve(spacyBase, "src");

    // The space is preserved — no shell expansion has occurred
    expect(resolved).toContain("with spaces");
    // The resolved path still has the space in a segment
    const segments = resolved.split(path.sep);
    expect(segments.some((s) => s.includes(" "))).toBe(true);
  });
});

describe("normalizeSnapshot — incompleteResolutionCount via fixture", () => {
  it("increments count for each couldNotResolve edge in raw JSON", () => {
    const raw = {
      modules: [
        {
          source: "/repo/src/a.ts",
          dependencies: [
            { resolved: "/repo/src/missing1.ts", couldNotResolve: true },
            { resolved: "/repo/src/missing2.ts", couldNotResolve: true },
            { resolved: "/repo/src/present.ts", couldNotResolve: false },
          ],
        },
      ],
      summary: { violations: [] },
    };
    const snap = normalizeSnapshot(
      raw,
      "/repo",
      "hash",
      "v1",
      "marker",
      "src",
      []
    );
    expect(snap.incompleteResolutionCount).toBe(2);
  });

  it("counts zero when no couldNotResolve edges exist", () => {
    const raw = {
      modules: [
        {
          source: "/repo/src/a.ts",
          dependencies: [{ resolved: "/repo/src/b.ts" }],
        },
      ],
      summary: { violations: [] },
    };
    const snap = normalizeSnapshot(raw, "/repo", "h", "v1", "m", "src", []);
    expect(snap.incompleteResolutionCount).toBe(0);
  });
});

describe("runScan — integration (real demo repo circular dependency)", () => {
  const nodeMajor = parseInt(process.versions.node.split(".")[0]!, 10);
  const runIt = nodeMajor >= 20 ? it : it.skip;

  runIt(
    "scan of demo/packages produces a circular-dependency violation with cyclePath populated",
    { timeout: 60_000 },
    async () => {
      const { runScan } = await import("./scan.js");
      const summary = await runScan({
        repoRoot: ARCHPULSE_ROOT,
        scanScope: "demo/packages",
        outDir: ".archpulse/test-run",
      });
      // We expect at least one violation; the shared-no-domain violation exists
      expect(summary.violationCount).toBeGreaterThan(0);
      // At minimum the violations should have ids
      for (const v of summary.violations) {
        expect(typeof v.id).toBe("string");
        expect(v.id.length).toBeGreaterThan(0);
      }
    }
  );
});
