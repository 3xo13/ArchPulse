/**
 * Focused tests for Owner C: grouping.ts + casePacket.ts
 *
 * Coverage:
 *  - snapshot-before.json fixture produces exactly 2 separate cases
 *  - deterministic IDs / stable ordering across repeated calls
 *  - unrelated same-rule violations remain in separate groups
 *  - violations sharing a common from/to file are merged
 *  - violations sharing a cyclePath member are merged
 *  - component with >6 primary files is split deterministically
 *  - empty violations array
 *  - unsupported schemaVersion in cases.ts
 *  - CasePacket matches SCHEMA.md contract fields
 *  - JSON packet stays within the ~2 KB compact budget
 */

import { describe, it, expect, afterEach } from "vitest";
import { groupViolations } from "../core/grouping.js";
import { buildCasePacket } from "../core/casePacket.js";
import type { SnapshotInput, SnapshotViolation } from "../core/grouping.js";
import type { ArchitectureConfig } from "../core/casePacket.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SNAPSHOT_BEFORE: SnapshotInput = {
  schemaVersion: "1",
  gitMarker: "baseline",
  modules: [
    { path: "demo/packages/db/src/index.ts",        package: "@demo/db",     layer: "db" },
    { path: "demo/packages/db/src/repository.ts",   package: "@demo/db",     layer: "db" },
    { path: "demo/packages/domain/src/index.ts",    package: "@demo/domain", layer: "domain" },
    { path: "demo/packages/domain/src/order.ts",    package: "@demo/domain", layer: "domain" },
    { path: "demo/packages/shared/src/index.ts",    package: "@demo/shared", layer: "shared" },
    { path: "demo/packages/shared/src/types.ts",    package: "@demo/shared", layer: "shared" },
    { path: "demo/packages/ui/src/index.ts",        package: "@demo/ui",     layer: "ui" },
    { path: "demo/packages/ui/src/orderService.ts", package: "@demo/ui",     layer: "ui" },
  ],
  violations: [
    {
      id: "shared-no-domain::demo/packages/shared/src/index.ts::demo/packages/domain/src/index.ts",
      rule: "shared-no-domain",
      from: "demo/packages/shared/src/index.ts",
      to: "demo/packages/domain/src/index.ts",
      severity: "error",
      cyclePath: null,
      evidence: "shared imports { formatOrder } from @demo/domain",
    },
    {
      id: "ui-no-db::demo/packages/ui/src/orderService.ts::demo/packages/db/src/index.ts",
      rule: "ui-no-db",
      from: "demo/packages/ui/src/orderService.ts",
      to: "demo/packages/db/src/index.ts",
      severity: "error",
      cyclePath: null,
      evidence: "ui imports { saveOrder, findOrdersByUser } from @demo/db",
    },
  ],
};

const ARCH_CONFIG: ArchitectureConfig = {
  schemaVersion: "1",
  layers: [
    { name: "shared", glob: "demo/packages/shared/src/**" },
    { name: "db",     glob: "demo/packages/db/src/**" },
    { name: "domain", glob: "demo/packages/domain/src/**" },
    { name: "ui",     glob: "demo/packages/ui/src/**" },
  ],
  allowedDependencies: [],
  forbiddenDependencies: [
    { from: "ui",     to: "db",     reason: "UI must not know about the data-access layer; route through domain instead." },
    { from: "shared", to: "domain", reason: "shared is a lower-level package and must not import from higher-level domain." },
  ],
  testCommands: [
    "npx vitest run demo/packages/domain/src",
    "npx vitest run demo/packages/db/src",
    "npx vitest run demo/packages/ui/src",
  ],
};

// ---------------------------------------------------------------------------
// Helper: build a minimal violation
// ---------------------------------------------------------------------------

function makeViolation(
  rule: string,
  from: string,
  to: string,
  opts: Partial<SnapshotViolation> = {},
): SnapshotViolation {
  return {
    id: `${rule}::${from}::${to}`,
    rule,
    from,
    to,
    severity: "error",
    cyclePath: null,
    evidence: `${from} → ${to}`,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// groupViolations — snapshot-before fixture
// ---------------------------------------------------------------------------

describe("groupViolations — snapshot-before.json fixture", () => {
  it("produces exactly 2 groups for the two unrelated violations", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    expect(groups).toHaveLength(2);
  });

  it("each group contains exactly 1 violation", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    expect(groups[0]?.violations).toHaveLength(1);
    expect(groups[1]?.violations).toHaveLength(1);
  });

  it("the two violations end up in separate groups (not merged by same-rule logic)", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    const ruleA = groups[0]?.violations[0]?.rule;
    const ruleB = groups[1]?.violations[0]?.rule;
    // They have different rules, but the key assertion is they are separate
    expect(ruleA).not.toEqual(ruleB);
  });

  it("groups are ordered by groupKey (lex-smallest violation.id)", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    // "shared-no-domain..." < "ui-no-db..." lexicographically
    expect(groups[0]?.groupKey).toMatch(/^shared-no-domain/);
    expect(groups[1]?.groupKey).toMatch(/^ui-no-db/);
  });

  it("primaryFiles are ≤6 for each group", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    for (const g of groups) {
      expect(g.primaryFiles.length).toBeLessThanOrEqual(6);
    }
  });
});

// ---------------------------------------------------------------------------
// groupViolations — deterministic / stable
// ---------------------------------------------------------------------------

describe("groupViolations — determinism", () => {
  it("produces identical results on repeated calls with the same input", () => {
    const a = groupViolations(SNAPSHOT_BEFORE);
    const b = groupViolations(SNAPSHOT_BEFORE);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("produces the same groupKeys regardless of input array order", () => {
    const reversed: SnapshotInput = {
      ...SNAPSHOT_BEFORE,
      violations: [...SNAPSHOT_BEFORE.violations].reverse(),
    };
    const a = groupViolations(SNAPSHOT_BEFORE);
    const b = groupViolations(reversed);
    const keysA = a.map((g) => g.groupKey).sort();
    const keysB = b.map((g) => g.groupKey).sort();
    expect(keysA).toEqual(keysB);
  });
});

// ---------------------------------------------------------------------------
// groupViolations — same-rule violations must NOT be merged
// ---------------------------------------------------------------------------

describe("groupViolations — same-rule violations stay separate when unrelated", () => {
  it("does not merge two ui-no-db violations that share no files", () => {
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("ui-no-db", "packages/ui-a/src/a.ts", "packages/db/src/index.ts"),
        makeViolation("ui-no-db", "packages/ui-b/src/b.ts", "packages/db2/src/index.ts"),
      ],
    };
    const groups = groupViolations(snapshot);
    // Different from AND different to → no shared file → should be 2 groups
    expect(groups).toHaveLength(2);
  });

  it("DOES merge two violations of different rules that share a from file", () => {
    const sharedFrom = "packages/ui/src/service.ts";
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("rule-a", sharedFrom, "packages/db/src/index.ts"),
        makeViolation("rule-b", sharedFrom, "packages/infra/src/index.ts"),
      ],
    };
    const groups = groupViolations(snapshot);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.violations).toHaveLength(2);
  });

  it("DOES merge two violations of same rule that share a to file", () => {
    const sharedTo = "packages/db/src/index.ts";
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("ui-no-db", "packages/ui/src/a.ts", sharedTo),
        makeViolation("ui-no-db", "packages/ui/src/b.ts", sharedTo),
      ],
    };
    const groups = groupViolations(snapshot);
    // Both point to the same 'to' file → merged
    expect(groups).toHaveLength(1);
    expect(groups[0]!.violations).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// groupViolations — cycle path merging
// ---------------------------------------------------------------------------

describe("groupViolations — cycle path merging", () => {
  it("merges two violations that share a cyclePath member", () => {
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("no-circular", "pkg/a.ts", "pkg/b.ts", {
          cyclePath: ["pkg/a.ts", "pkg/b.ts", "pkg/c.ts"],
        }),
        makeViolation("no-circular", "pkg/c.ts", "pkg/a.ts", {
          id: "no-circular::pkg/c.ts::pkg/a.ts",
          cyclePath: ["pkg/c.ts", "pkg/a.ts", "pkg/d.ts"],
        }),
      ],
    };
    const groups = groupViolations(snapshot);
    // Both cycles contain "pkg/a.ts" → merged into 1 group
    expect(groups).toHaveLength(1);
    expect(groups[0]!.violations).toHaveLength(2);
  });

  it("does NOT merge cyclic violations that share no cycle members", () => {
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("no-circular", "pkg/a.ts", "pkg/b.ts", {
          cyclePath: ["pkg/a.ts", "pkg/b.ts"],
        }),
        makeViolation("no-circular", "pkg/x.ts", "pkg/y.ts", {
          id: "no-circular::pkg/x.ts::pkg/y.ts",
          cyclePath: ["pkg/x.ts", "pkg/y.ts"],
        }),
      ],
    };
    const groups = groupViolations(snapshot);
    // Disjoint cycles → 2 separate groups
    expect(groups).toHaveLength(2);
  });

  it("correctly handles cyclePath: null (does not throw)", () => {
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [
        makeViolation("rule-x", "pkg/a.ts", "pkg/b.ts", { cyclePath: null }),
        makeViolation("rule-y", "pkg/c.ts", "pkg/d.ts", { cyclePath: null }),
      ],
    };
    expect(() => groupViolations(snapshot)).not.toThrow();
    const groups = groupViolations(snapshot);
    expect(groups).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// groupViolations — >6 file split
// ---------------------------------------------------------------------------

describe("groupViolations — >6 primary files split", () => {
  /**
   * Build a chain: a→b, b→c, c→d, d→e, e→f, f→g, g→h
   * All share consecutive files so union-find merges them into one component,
   * but the total unique files (a,b,c,d,e,f,g,h) = 8 > 6.
   */
  function buildLargeChainSnapshot(): SnapshotInput {
    const files = ["a", "b", "c", "d", "e", "f", "g", "h"].map(
      (x) => `pkg/src/${x}.ts`,
    );
    const violations: SnapshotViolation[] = [];
    for (let i = 0; i < files.length - 1; i++) {
      violations.push(
        makeViolation("boundary-rule", files[i]!, files[i + 1]!),
      );
    }
    return { schemaVersion: "1", gitMarker: "test", violations };
  }

  it("splits a component with 8 unique files into multiple groups of ≤6 files each", () => {
    const snapshot = buildLargeChainSnapshot();
    const groups = groupViolations(snapshot);
    expect(groups.length).toBeGreaterThan(1);
    for (const g of groups) {
      expect(g.primaryFiles.length).toBeLessThanOrEqual(6);
    }
  });

  it("split groups carry relatedGroups cross-links", () => {
    const snapshot = buildLargeChainSnapshot();
    const groups = groupViolations(snapshot);
    // Every group that resulted from a split should have relatedGroups
    for (const g of groups) {
      expect(g.relatedGroups).toBeDefined();
      expect(g.relatedGroups!.length).toBeGreaterThan(0);
    }
  });

  it("the split is deterministic across repeated calls", () => {
    const snapshot = buildLargeChainSnapshot();
    const a = groupViolations(snapshot);
    const b = groupViolations(snapshot);
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// groupViolations — empty violations
// ---------------------------------------------------------------------------

describe("groupViolations — empty violations", () => {
  it("returns an empty array for a snapshot with no violations", () => {
    const snapshot: SnapshotInput = {
      schemaVersion: "1",
      gitMarker: "test",
      violations: [],
    };
    const groups = groupViolations(snapshot);
    expect(groups).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildCasePacket — contract fields
// ---------------------------------------------------------------------------

describe("buildCasePacket — SCHEMA.md contract", () => {
  function firstGroup() {
    return groupViolations(SNAPSHOT_BEFORE)[0]!;
  }

  it("produces a packet with all required CasePacket fields", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    const pkt = result.json;

    expect(pkt.caseId).toEqual("case-001");
    expect(pkt.scanId).toEqual(SNAPSHOT_BEFORE.gitMarker);
    expect(typeof pkt.title).toEqual("string");
    expect(pkt.title.length).toBeGreaterThan(0);
    expect(typeof pkt.rule).toEqual("string");
    expect(pkt.severity === "error" || pkt.severity === "warn").toBe(true);
    expect(Array.isArray(pkt.violations)).toBe(true);
    expect(Array.isArray(pkt.primaryFiles)).toBe(true);
    expect(Array.isArray(pkt.relevantTests)).toBe(true);
    expect(Array.isArray(pkt.testCommands)).toBe(true);
    expect(typeof pkt.ruleExplanation).toEqual("string");
    expect(typeof pkt.expectedEndCondition).toEqual("string");
  });

  it("scanId matches snapshot.gitMarker", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.scanId).toEqual("baseline");
  });

  it("primaryFiles are ≤6", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.primaryFiles.length).toBeLessThanOrEqual(6);
  });

  it("testCommands come from config.testCommands", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.testCommands).toEqual(ARCH_CONFIG.testCommands);
  });

  it("expectedEndCondition mentions the rule", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.expectedEndCondition).toContain(result.json.rule);
  });

  it("ruleExplanation uses the forbidden dependency reason from config", () => {
    // The ui-no-db group maps to the forbidden rule from="ui" to="db"
    const groups = groupViolations(SNAPSHOT_BEFORE);
    const uiDbGroup = groups.find((g) =>
      g.violations[0]!.rule === "ui-no-db",
    )!;
    const result = buildCasePacket("case-002", uiDbGroup, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.ruleExplanation).toContain("domain");
  });

  it("title includes layer names when derivable", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    const uiDbGroup = groups.find((g) => g.violations[0]!.rule === "ui-no-db")!;
    const result = buildCasePacket("case-002", uiDbGroup, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.title).toContain("ui");
    expect(result.json.title).toContain("db");
  });

  it("relevantTests does not invent files missing from the module inventory", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.json.relevantTests).toEqual([]);
  });

  it("produces a non-empty markdown string", () => {
    const group = firstGroup();
    const result = buildCasePacket("case-001", group, SNAPSHOT_BEFORE, ARCH_CONFIG);
    expect(result.markdown.length).toBeGreaterThan(0);
    expect(result.markdown).toContain("case-001");
  });
});

// ---------------------------------------------------------------------------
// buildCasePacket — JSON size budget
// ---------------------------------------------------------------------------

describe("buildCasePacket — JSON size budget", () => {
  it("packet for a single violation is well under 2 KB", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    for (let i = 0; i < groups.length; i++) {
      const result = buildCasePacket(`case-00${i + 1}`, groups[i]!, SNAPSHOT_BEFORE, ARCH_CONFIG);
      expect(result.jsonByteLength).toBeLessThan(2048);
      expect(result.exceedsBudget).toBe(false);
    }
  });

  it("exceedsBudget is false for the fixture snapshot cases", () => {
    const groups = groupViolations(SNAPSHOT_BEFORE);
    for (let i = 0; i < groups.length; i++) {
      const result = buildCasePacket(`case-00${i + 1}`, groups[i]!, SNAPSHOT_BEFORE, ARCH_CONFIG);
      expect(result.exceedsBudget).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// cases.ts — runCases() integration tests
// ---------------------------------------------------------------------------

import { runCases as invokeCases } from "../cli/cases.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const caseTemps: string[] = [];
afterEach(() => { for (const directory of caseTemps.splice(0)) fs.rmSync(directory,{recursive:true,force:true}); });
async function runCases(args: string[]) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"archpulse-case-test-root-")); caseTemps.push(root);
  const normalized=[...args];
  for (const flag of ["--snapshot","--config"]) {
    const i=normalized.indexOf(flag); if (i>=0 && normalized[i+1]) normalized[i+1]=path.resolve(normalized[i+1]!);
  }
  if (!normalized.includes("--config")) normalized.push("--config",path.resolve("config/architecture.json"));
  return invokeCases([...normalized,"--repo",root]);
}

describe("runCases — CLI orchestration", () => {
  function tmpDir() {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-test-")); caseTemps.push(directory); return directory;
  }

  const SNAPSHOT_PATH = "artifacts/example/snapshot-before.json";
  const CONFIG_PATH   = "config/architecture.json";

  it("generates 2 case files from the example snapshot", async () => {
    const out = tmpDir();
    const result = await runCases([
      "--snapshot", SNAPSHOT_PATH,
      "--out",      out,
      "--config",   CONFIG_PATH,
    ]);
    expect(result.caseCount).toEqual(2);
    expect(fs.existsSync(path.join(out, "case-001.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "case-001.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, "case-002.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "case-002.md"))).toBe(true);
    expect(fs.existsSync(path.join(out, "index.json"))).toBe(true);
  });

  it("index.json lists both cases with correct fields", async () => {
    const out = tmpDir();
    await runCases([
      "--snapshot", SNAPSHOT_PATH,
      "--out",      out,
      "--config",   CONFIG_PATH,
    ]);
    const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
    expect(index.cases).toHaveLength(2);
    for (const entry of index.cases) {
      expect(entry.caseId).toMatch(/^case-\d{3}$/);
      expect(typeof entry.title).toEqual("string");
      expect(entry.violationCount).toBeGreaterThan(0);
    }
  });

  it("case-001.json is valid JSON with all required fields", async () => {
    const out = tmpDir();
    await runCases([
      "--snapshot", SNAPSHOT_PATH,
      "--out",      out,
      "--config",   CONFIG_PATH,
    ]);
    const pkt = JSON.parse(fs.readFileSync(path.join(out, "case-001.json"), "utf8"));
    expect(typeof pkt.caseId).toEqual("string");
    expect(typeof pkt.scanId).toEqual("string");
    expect(typeof pkt.title).toEqual("string");
    expect(typeof pkt.rule).toEqual("string");
    expect(Array.isArray(pkt.violations)).toBe(true);
    expect(Array.isArray(pkt.primaryFiles)).toBe(true);
    expect(Array.isArray(pkt.relevantTests)).toBe(true);
    expect(Array.isArray(pkt.testCommands)).toBe(true);
    expect(typeof pkt.ruleExplanation).toEqual("string");
    expect(typeof pkt.expectedEndCondition).toEqual("string");
  });

  it("throws an error for unsupported schemaVersion", async () => {
    const out = tmpDir();
    const badSnap = path.join(out, "bad-snapshot.json");
    fs.writeFileSync(
      badSnap,
      JSON.stringify({
        schemaVersion: "99",
        gitMarker: "test", root:"src", configHash:"test", incompleteResolutionCount:0,
        violations: [],
        modules: [],
      }),
    );
    await expect(
      runCases(["--snapshot", badSnap, "--out", out, "--config", CONFIG_PATH]),
    ).rejects.toThrow("schemaVersion");
  });

  it("exits cleanly with 0 cases for an empty violations array", async () => {
    const out = tmpDir();
    const emptySnap = path.join(out, "empty-snapshot.json");
    fs.writeFileSync(
      emptySnap,
      JSON.stringify({
        schemaVersion: "1",
        gitMarker: "test", root:"src", configHash:"test", incompleteResolutionCount:0,
        violations: [],
        modules: [],
      }),
    );
    const result = await runCases([
      "--snapshot", emptySnap,
      "--out",      out,
      "--config",   CONFIG_PATH,
    ]);
    expect(result.caseCount).toEqual(0);
    const index = JSON.parse(fs.readFileSync(path.join(out, "index.json"), "utf8"));
    expect(index.cases).toHaveLength(0);
  });

  it("throws when --snapshot is missing", async () => {
    await expect(runCases(["--out", "/tmp/x"])).rejects.toThrow("--snapshot");
  });

  it("defaults output beside the snapshot when --out is missing", async () => {
    const directory=tmpDir(); const snapshot=path.join(directory,"snapshot.json");
    fs.copyFileSync(SNAPSHOT_PATH,snapshot);
    const result=await runCases(["--snapshot",snapshot]);
    expect(result.outDir).toBe(path.join(directory,"cases"));
  });
});
