import { describe, expect, it } from "vitest";
import beforeFixture from "../../artifacts/example/snapshot-before.json";
import afterFixture from "../../artifacts/example/snapshot-after.json";
import packetFixture from "../../artifacts/example/case-001.json";
import resultFixture from "../../artifacts/example/result.json";
import { readArtifact, validateReport } from "./report";
import { checkOutcome, testSummary, vitestCounts } from "./checkSummary";
import { revisionFromMarker, sourceUrl } from "./sourceUrl";
import { focusedGraph, edgeKey } from "./graph";
import type { Snapshot } from "./types";

const input = () => JSON.parse(JSON.stringify({ before: beforeFixture, after: afterFixture, packet: packetFixture, result: resultFixture })) as {
  before: Snapshot; after?: Snapshot; packet: typeof packetFixture; result: typeof resultFixture;
};
describe("artifact validation", () => {
  it("accepts the unchanged public example contracts and additive fields", () => {
    expect(validateReport({ ...input(), result: { ...resultFixture, futureField: true } }).result.status).toBe("verified");
  });
  it.each(["caseId", "baselineId", "afterId"])("rejects a mismatched result %s", field => {
    const f = input(); f.result[field as "caseId"] = "wrong";
    expect(() => validateReport(f)).toThrow(field);
  });
  it("rejects null, duplicate IDs, unsafe paths and invalid command fields", () => {
    expect(() => validateReport({ ...input(), packet: null })).toThrow("Case packet");
    const f = input(); f.before.violations.push(f.before.violations[0]!);
    expect(() => validateReport(f)).toThrow("Duplicate violation IDs");
    for (const path of ["../secret", "C:\\secret", "\\\\server\\share", "/etc/passwd"]) {
      const other = input(); other.packet.primaryFiles[0] = path;
      expect(() => validateReport(other)).toThrow("primaryFiles");
    }
    expect(() => validateReport({ ...input(), packet: { ...packetFixture, testCommands: [null] } })).toThrow("testCommands");
  });
  it("rejects foreign case evidence and fabricated comparison arrays", () => {
    const f = input(); f.packet.violations[0]!.from = "other.ts";
    expect(() => validateReport(f)).toThrow("selected violations");
    const other = input(); other.result.resolvedViolations = [];
    expect(() => validateReport(other)).toThrow("resolvedViolations");
  });
  it.each(["tests", "types", "config", "scope", "resolution", "new", "persistent"])("rejects impossible verified reports: %s", mode => {
    const f = input();
    if (mode === "tests") f.result.testExitCode = 1;
    if (mode === "types") f.result.typecheckExitCode = -1;
    if (mode === "config") f.after!.configHash = "other";
    if (mode === "scope") f.after!.root = "other";
    if (mode === "resolution") f.after!.incompleteResolutionCount = 1;
    if (mode === "new") f.after!.violations.push({ ...f.before.violations[0]!, id: "new" });
    if (mode === "persistent") f.after!.violations = f.before.violations;
    expect(() => validateReport(f)).toThrow();
  });
  it("accepts legitimate failed, partial and invalid reports", () => {
    const failed = input(); failed.result.status = "failed"; failed.result.testExitCode = 1;
    expect(validateReport(failed).result.status).toBe("failed");
    const partial = input(); partial.packet.violations = partial.before.violations as typeof partial.packet.violations;
    partial.result.status = "partial";
    expect(validateReport(partial).result.status).toBe("partial");
    const invalid = input(); invalid.result.status = "invalid"; invalid.after!.configHash = "changed";
    expect(validateReport(invalid).result.status).toBe("invalid");
  });
  it.each(["failed", "invalid"])("accepts interrupted %s without an after snapshot", status => {
    const f = input(); delete f.after; f.result.afterId = ""; f.result.status = status;
    f.result.resolvedViolations = []; f.result.persistentViolations = []; f.result.newViolations = [];
    expect(validateReport(f).after).toBeUndefined();
  });
  it("requires the after snapshot for a completed comparison", () => {
    const f = input(); delete f.after;
    expect(() => validateReport(f)).toThrow("afterId");
  });
  it("rejects contradictory execution details", () => {
    expect(() => validateReport({ ...input(), execution: { tests: [{ command: "foreign", exitCode: 0, output: "" }], typechecks: [], expectedTests: 1, expectedTypes: 0 } })).toThrow("execution test commands");
  });
  it("checks file size before reading and names malformed JSON", async () => {
    let read = false;
    const file = { size: 20 * 1024 * 1024 + 1, text: async () => { read = true; return "{}"; } } as File;
    await expect(readArtifact(file, "before")).rejects.toThrow("20 MiB"); expect(read).toBe(false);
    await expect(readArtifact({ size: 1, text: async () => "{" } as File, "result")).rejects.toThrow("Verification result");
  });
});
describe("check summaries", () => {
  const result = validateReport(input()).result;
  it("shows 14 tests instead of three test files", () => expect(testSummary(result)).toBe("Passed · 14 passed"));
  it("strips ANSI formatting and handles failures and skipped tests", () => {
    expect(vitestCounts("\u001b[32m Tests  1 failed | 3 passed | 2 skipped (6)\u001b[0m")).toEqual({ failed: 1, passed: 3, skipped: 2 });
  });
  it.each(["Tests 3 passed (4)", "Tests 3 passed (3)\n[output truncated]", "Tests 3 passed (3)\nTests 3 passed (3)", "3 tests passed"])("does not guess totals from %s", output => {
    expect(testSummary({ ...result, testOutput: output })).toBe("Passed");
  });
  it("aggregates only complete recognized execution logs", () => {
    const runs = [{ command: "one", exitCode: 0, output: "Test Files 1 passed (1)\nTests 4 passed (4)" }, { command: "two", exitCode: 0, output: "Tests 3 passed (3)" }];
    const execution = { tests: runs, typechecks: [], expectedTests: 2, expectedTypes: 0 };
    expect(testSummary({ ...result, testCommand: "one\ntwo" }, execution)).toBe("Passed · 7 passed");
    expect(testSummary(result, { ...execution, expectedTests: 3 })).toBe("Passed");
    runs[1]!.output = "unrecognized runner";
    expect(testSummary(result, execution)).toBe("Passed");
  });
  it("never infers success from a count", () => {
    expect(testSummary({ ...result, testExitCode: 1 })).toBe("Failed · 14 passed");
    expect(testSummary({ ...result, testExitCode: -1 })).toBe("Not run");
    expect(checkOutcome(124)).toBe("Failed");
  });
});
describe("source links and focused cycles", () => {
  it("encodes revision and file segments; refuses ambiguous or unsafe sources", () => {
    expect(sourceUrl("https://github.com/team/project", "feature/my#branch", "src/a #?.ts")).toBe("https://github.com/team/project/blob/feature%2Fmy%23branch/src/a%20%23%3F.ts");
    expect(sourceUrl("javascript:alert(1)", "main", "a.ts")).toBeUndefined();
    expect(sourceUrl("https://github.com/team/project", "main", "../a.ts")).toBeUndefined();
    expect(sourceUrl("https://github.com/team/project", "", "a.ts")).toBeUndefined();
    expect(revisionFromMarker("working-tree")).toBe("");
    expect(revisionFromMarker("baseline")).toBe("");
    expect(revisionFromMarker("daee2a8")).toBe("daee2a8");
  });
  it.each([3, 9])("includes and highlights an entire %i-node cycle beyond primary files", count => {
    const members = Array.from({ length: count }, (_, i) => `${i}.ts`);
    const snapshot = { ...validateReport(input()).before, modules: [],
      edges: members.map((from, i) => ({ from, to: members[(i + 1) % count]!, dependencyType: "local" })),
      violations: [{ id: "cycle", rule: "no-circular", from: members[0]!, to: members[1]!, severity: "error" as const, cyclePath: [...members, members[0]!] }] };
    const graph = focusedGraph(snapshot, new Set([members[0]!]));
    expect(graph.edges).toHaveLength(count); expect(graph.nodes.size).toBe(count);
    expect(graph.edges.every(edge => graph.highlighted.has(edgeKey(edge.from, edge.to)))).toBe(true);
  });
  it("does not invent edges, and keeps ordinary dependencies", () => {
    const snapshot = validateReport(input()).before;
    const graph = focusedGraph(snapshot, new Set(packetFixture.primaryFiles));
    expect(graph.edges.every(edge => snapshot.edges.includes(edge))).toBe(true);
    expect(graph.edges.length).toBeGreaterThan(0);
  });
});
