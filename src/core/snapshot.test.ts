import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import {
  normalizePath,
  computeConfigHash,
  makeViolationId,
  makeCycleId,
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
