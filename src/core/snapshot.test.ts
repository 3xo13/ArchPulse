import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  normalizePath,
  computeConfigHash,
  hashConfig,
  makeViolationId,
  makeCycleId,
  normalizeSnapshot,
} from "./snapshot.js";

const REPO_ROOT = resolve(process.cwd());

describe("normalizePath", () => {
  it("converts an absolute path to a repo-relative forward-slash path", () => {
    const abs = resolve(REPO_ROOT, "demo/packages/ui/src/orderService.ts");
    expect(normalizePath(abs, REPO_ROOT)).toBe(
      "demo/packages/ui/src/orderService.ts",
    );
  });

  it("normalizes backslashes to forward slashes", () => {
    // Simulate a Windows path string even on non-Windows
    const winPath = REPO_ROOT.replace(/\//g, "\\") + "\\demo\\packages\\db\\src\\index.ts";
    expect(normalizePath(winPath, REPO_ROOT)).toBe(
      "demo/packages/db/src/index.ts",
    );
  });

  it("returns the path unchanged when already repo-relative", () => {
    const rel = "demo/packages/shared/src/types.ts";
    expect(normalizePath(rel, REPO_ROOT)).toBe(rel);
  });

  it("defaults repoRoot to process.cwd()", () => {
    const rel = "demo/packages/domain/src/order.ts";
    expect(normalizePath(rel)).toBe(rel);
  });
});

describe("computeConfigHash", () => {
  it("returns a 64-character hex string", () => {
    const hash = computeConfigHash(".dependency-cruiser.cjs");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns the same hash on repeated calls for the same file", () => {
    const h1 = computeConfigHash(".dependency-cruiser.cjs");
    const h2 = computeConfigHash(".dependency-cruiser.cjs");
    expect(h1).toBe(h2);
  });
});

describe("makeViolationId", () => {
  it("produces the expected colon-separated format", () => {
    const id = makeViolationId(
      "ui-no-db",
      "demo/packages/ui/src/orderService.ts",
      "demo/packages/db/src/index.ts",
    );
    expect(id).toBe(
      "ui-no-db::demo/packages/ui/src/orderService.ts::demo/packages/db/src/index.ts",
    );
  });

  it("is stable — same inputs always produce the same ID", () => {
    const a = makeViolationId("rule-x", "from/a.ts", "to/b.ts");
    const b = makeViolationId("rule-x", "from/a.ts", "to/b.ts");
    expect(a).toBe(b);
  });

  it("differs when any argument differs", () => {
    const base = makeViolationId("rule-x", "from/a.ts", "to/b.ts");
    expect(makeViolationId("rule-y", "from/a.ts", "to/b.ts")).not.toBe(base);
    expect(makeViolationId("rule-x", "from/z.ts", "to/b.ts")).not.toBe(base);
    expect(makeViolationId("rule-x", "from/a.ts", "to/z.ts")).not.toBe(base);
  });
});

describe("makeCycleId", () => {
  it("produces a sorted, stable ID regardless of member order", () => {
    const members = [
      "demo/packages/shared/src/index.ts",
      "demo/packages/domain/src/index.ts",
    ];
    const id1 = makeCycleId(members);
    const id2 = makeCycleId([...members].reverse());
    expect(id1).toBe(id2);
  });

  it("starts with no-circular::", () => {
    const id = makeCycleId(["a.ts", "b.ts"]);
    expect(id).toMatch(/^no-circular::/);
  });

  it("does not mutate the input array", () => {
    const members = ["z.ts", "a.ts", "m.ts"];
    const copy = [...members];
    makeCycleId(members);
    expect(members).toEqual(copy);
  });
});

describe("hashConfig", () => {
  it("returns the same 64-char hex as computeConfigHash for the same file", () => {
    const abs = resolve(process.cwd(), ".dependency-cruiser.cjs");
    expect(hashConfig(abs)).toBe(computeConfigHash());
  });
});

describe("makeViolationId with cyclePath", () => {
  it("appends cycle hash when cyclePath is provided", () => {
    const id = makeViolationId("no-circular", "a.ts", "b.ts", ["a.ts", "b.ts"]);
    expect(id).toMatch(/^no-circular::a\.ts::b\.ts::cycle::[0-9a-f]{8}$/);
  });

  it("cycle hash is stable regardless of cyclePath member order", () => {
    const id1 = makeViolationId("no-circular", "a.ts", "b.ts", ["a.ts", "b.ts"]);
    const id2 = makeViolationId("no-circular", "a.ts", "b.ts", ["b.ts", "a.ts"]);
    expect(id1).toBe(id2);
  });

  it("returns base id when cyclePath is empty", () => {
    const id = makeViolationId("rule-x", "a.ts", "b.ts", []);
    expect(id).toBe("rule-x::a.ts::b.ts");
  });
});

describe("normalizeSnapshot", () => {
  const repoRoot = resolve(process.cwd());
  const configHash = computeConfigHash();
  const layerMap = [
    { name: "shared", glob: "demo/packages/shared/src/**" },
    { name: "ui",     glob: "demo/packages/ui/src/**" },
  ];

  const rawDc = {
    modules: [
      {
        source: `${repoRoot}/demo/packages/ui/src/orderService.ts`.replace(/\//g, "\\"),
        dependencies: [
          {
            resolved: `${repoRoot}/demo/packages/shared/src/index.ts`.replace(/\//g, "\\"),
            dependencyTypes: ["workspace"],
          },
        ],
      },
    ],
    summary: {
      violations: [
        {
          rule: { name: "ui-no-db", severity: "error" },
          from: `${repoRoot}/demo/packages/ui/src/orderService.ts`.replace(/\//g, "\\"),
          to:   `${repoRoot}/demo/packages/shared/src/index.ts`.replace(/\//g, "\\"),
        },
      ],
      error: 1,
      warn: 0,
    },
  };

  it("produces a snapshot matching the schema contract", () => {
    const snap = normalizeSnapshot(rawDc, repoRoot, configHash, "dependency-cruiser@16", "abc1234", "demo/packages", layerMap);
    expect(snap.schemaVersion).toBe("1");
    expect(snap.configHash).toBe(configHash);
    expect(snap.modules).toHaveLength(1);
    expect(snap.modules[0]!.path).toBe("demo/packages/ui/src/orderService.ts");
    expect(snap.modules[0]!.layer).toBe("ui");
    expect(snap.edges).toHaveLength(1);
    expect(snap.violations).toHaveLength(1);
    expect(snap.violations[0]!.rule).toBe("ui-no-db");
    expect(snap.violations[0]!.id).toMatch(/^ui-no-db::/);
  });

  it("all paths in the snapshot are forward-slash normalized", () => {
    const snap = normalizeSnapshot(rawDc, repoRoot, configHash, "dc@16", "abc", "demo/packages", layerMap);
    for (const m of snap.modules) expect(m.path).not.toContain("\\");
    for (const e of snap.edges) {
      expect(e.from).not.toContain("\\");
      expect(e.to).not.toContain("\\");
    }
    for (const v of snap.violations) {
      expect(v.from).not.toContain("\\");
      expect(v.to).not.toContain("\\");
    }
  });
});
