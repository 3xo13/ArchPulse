import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCase } from "./cases.js";
import { runScan } from "../cli/scan.js";
import { runConfiguredCommand } from "./runner.js";
import { verifyCase } from "./verify.js";
import { json, withRepositoryLock } from "./storage.js";

vi.mock("./cases.js", () => ({ getCase: vi.fn() }));
vi.mock("../cli/scan.js", () => ({ runScan: vi.fn() }));
vi.mock("./runner.js", () => ({ runConfiguredCommand: vi.fn() }));
vi.mock("./provenance.js", () => ({ policyHash: () => "policy", sourceState: () => "stable" }));
let root: string;
let release: (() => void) | undefined;
let holder: Promise<unknown> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); release = undefined; holder = undefined;
  root = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-publication-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/architecture.json"), json({ layers: [], forbiddenDependencies: [], testCommands: ["test"], typecheckCommands: ["types"] }));
  const violation = { id: "v", rule: "boundary", from: "a.ts", to: "b.ts", severity: "error", evidence: "edge", cyclePath: null };
  const snapshot = { schemaVersion: "1", root: "src", gitMarker: "before", configHash: "same", incompleteResolutionCount: 0, violations: [violation], modules: [] };
  const before = path.join(root, "before.json");
  fs.writeFileSync(before, json(snapshot));
  fs.writeFileSync(path.join(root, "after.json"), json({ ...snapshot, gitMarker: "after", violations: [] }));
  vi.mocked(getCase).mockResolvedValue({ snapshotPath: before, packet: { violations: [violation] }, manifest: { policyHash: "policy", configPath: "rules.cjs", scope: "src" } } as never);
  vi.mocked(runConfiguredCommand).mockImplementation(async kind => ({ command: kind, exitCode: 0, output: "passed" }));
  vi.mocked(runScan).mockResolvedValue({ baselineId: "after.json" } as never);
});
afterEach(async () => {
  release?.(); await holder;
  fs.rmSync(root, { recursive: true, force: true });
});
async function blockFinalPublication() {
  holder = withRepositoryLock(root, () => new Promise<void>(resolve => { release = resolve; }));
}
it.each(["cancel", "deadline"])("settles promptly when %s interrupts the publication lock", async mode => {
  const out = path.join(root, ".archpulse/result"); fs.mkdirSync(out, { recursive: true });
  for (const name of ["result.json", "result.md", "execution.json"]) fs.writeFileSync(path.join(out, name), `previous ${name}`);
  const controller = new AbortController();
  let scanned!: () => void; const ready = new Promise<void>(resolve => { scanned = resolve; });
  vi.mocked(runScan).mockImplementation(async () => {
    await blockFinalPublication(); scanned();
    return { baselineId: "after.json" } as never;
  });
  const started = Date.now();
  const verification = verifyCase({ repoRoot: root, baselineId: "before", caseId: "case-001", outDir: out,
    signal: controller.signal, timeoutMs: mode === "deadline" ? 150 : 10_000 });
  await ready;
  if (mode === "cancel") controller.abort();
  const response = await verification;
  expect(Date.now() - started).toBeLessThan(2000);
  expect(response.result.status).toBe("failed"); expect(response.result.reason).toContain("Report not saved");
  expect(response.resultPath).toBeUndefined();
  for (const name of ["result.json", "result.md", "execution.json"]) expect(fs.readFileSync(path.join(out, name), "utf8")).toBe(`previous ${name}`);
  release?.(); await holder;
  expect(fs.existsSync(path.join(root, ".archpulse/operation.lock"))).toBe(false);
});
it("publishes a cancellation failure immediately if the lock is free", async () => {
  const controller = new AbortController();
  vi.mocked(runScan).mockImplementation(async () => { controller.abort(); return { baselineId: "after.json" } as never; });
  const response = await verifyCase({ repoRoot: root, baselineId: "before", caseId: "case-001", signal: controller.signal });
  expect(response.result.status).toBe("failed"); expect(response.resultPath).toBeDefined();
  expect(JSON.parse(fs.readFileSync(response.resultPath!, "utf8")).status).toBe("failed");
  expect(fs.existsSync(path.join(root, ".archpulse/operation.lock"))).toBe(false);
});
it("publishes successful evidence after ordinary lock contention is resolved", async () => {
  vi.mocked(runScan).mockImplementation(async () => {
    await blockFinalPublication(); setTimeout(() => release?.(), 50);
    return { baselineId: "after.json" } as never;
  });
  const response = await verifyCase({ repoRoot: root, baselineId: "before", caseId: "case-001" });
  expect(response.result.status).toBe("verified"); expect(response.resultPath).toBeDefined();
  expect(JSON.parse(fs.readFileSync(response.resultPath!, "utf8")).status).toBe("verified");
});
it("propagates unrelated publication failures and releases the lock", async () => {
  const output = path.join(root, "out"); fs.mkdirSync(path.join(output, "result.json"), { recursive: true });
  await expect(verifyCase({ repoRoot: root, baselineId: "before", caseId: "case-001", outDir: output })).rejects.toThrow("regular file");
  expect(fs.existsSync(path.join(root, ".archpulse/operation.lock"))).toBe(false);
});
