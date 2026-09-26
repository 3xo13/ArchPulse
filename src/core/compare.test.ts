import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { compareSnapshots } from "./compare.js";
import type { SnapshotViolation } from "./snapshot.js";

const violation = (id: string, severity: SnapshotViolation["severity"] = "error"): SnapshotViolation => ({
  id, rule: "test-rule", from: `${id}.ts`, to: "target.ts", severity, cyclePath: null, evidence: "test",
});
const a = violation("a"), b = violation("b");
const snapshot = (violations = [a, b]) => ({ schemaVersion: "1", root: "src", configHash: "same", gitMarker: "baseline", incompleteResolutionCount: 0, violations });
let temp: string;
beforeEach(() => { temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-compare-")); });
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));
function compare(before: unknown, after: unknown, selected = [a, b]) {
  fs.writeFileSync(path.join(temp, "before.json"), JSON.stringify(before));
  fs.writeFileSync(path.join(temp, "after.json"), JSON.stringify(after));
  return compareSnapshots(path.join(temp, "before.json"), path.join(temp, "after.json"), { caseId: "case-001", violations: selected });
}
describe("architecture comparison", () => {
  it.each([[[], "verified"], [[b], "partial"], [[a, b], "failed"]] as const)("classifies remaining violations %j as %s", (remaining, status) => {
    const result = compare(snapshot(), snapshot([...remaining]));
    expect(result.status).toBe(status);
    expect(result.resolvedViolations.length + result.persistentViolations.length).toBe(2);
    if (status === "verified") expect(result.reason).toContain("Tests and typechecking were not run");
  });
  it.each(["error", "warn", "info"] as const)("fails on a new %s outside the selected case", severity => {
    const result = compare(snapshot(), snapshot([violation("outside", severity)]));
    expect(result.status).toBe("failed");
    expect(result.newViolations).toHaveLength(1);
    expect(result.resolvedViolations).toHaveLength(2);
    expect(result.reason).toContain("1 new violation");
  });
  it.each([
    { configHash: "changed" }, { root: "other" }, { root: "C:/legacy/src" },
    { root: "/legacy/src" }, { incompleteResolutionCount: 1 },
  ])("invalidates incompatible/incomplete snapshots %j", changes => {
    expect(compare(snapshot(), { ...snapshot([]), ...changes }).status).toBe("invalid");
  });
  it("normalizes scope separators and dot segments", () => {
    expect(compare({ ...snapshot(), root: "demo\\src\\" }, { ...snapshot([]), root: "demo/./src" }).status).toBe("verified");
  });
  it("rejects empty cases, missing baseline IDs, and incomplete baselines", () => {
    expect(compare(snapshot(), snapshot([]), []).status).toBe("invalid");
    expect(compare(snapshot(), snapshot([]), [violation("missing")]).status).toBe("invalid");
    expect(compare({ ...snapshot(), incompleteResolutionCount: 1 }, snapshot([])).status).toBe("invalid");
  });
  it("gives invalid precedence over new violations", () => {
    expect(compare(snapshot(), { ...snapshot([violation("new")]), configHash: "changed" }).status).toBe("invalid");
  });
  it.each([null, {}, { ...snapshot(), violations: [{}] }, { ...snapshot(), incompleteResolutionCount: -1 }])("rejects malformed snapshot %j", bad => {
    expect(() => compare(bad, snapshot())).toThrow(/Invalid snapshot/);
  });
  it("reports unreadable/invalid JSON files descriptively", () => {
    const missing = path.join(temp, "missing");
    expect(() => compareSnapshots(missing, missing, { caseId: "x", violations: [a] })).toThrow(/Cannot read snapshot/);
    fs.writeFileSync(missing, "{");
    expect(() => compareSnapshots(missing, missing, { caseId: "x", violations: [a] })).toThrow(/Cannot read snapshot/);
  });
});
