import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getCase } from "./cases.js";
import { runScan } from "../cli/scan.js";
import { runConfiguredCommand } from "./runner.js";
import { verifyCase } from "./verify.js";
import { json, withRepositoryLock } from "./storage.js";
import { sourceState } from "./provenance.js";
import { validateReport } from "../viewer/report.js";

vi.mock("./cases.js", () => ({ getCase: vi.fn() }));
vi.mock("../cli/scan.js", () => ({ runScan: vi.fn() }));
vi.mock("./runner.js", () => ({ runConfiguredCommand: vi.fn() }));
vi.mock("./provenance.js", () => ({ policyHash: () => "policy", sourceState: vi.fn(() => "stable") }));
let root: string;
let release: (() => void) | undefined;
let holder: Promise<unknown> | undefined;
beforeEach(() => {
  vi.clearAllMocks(); release = undefined; holder = undefined;
  vi.mocked(sourceState).mockReturnValue("stable");
  root = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-publication-"));
  fs.mkdirSync(path.join(root, "config"));
  fs.writeFileSync(path.join(root, "config/architecture.json"), json({ layers: [], forbiddenDependencies: [], testCommands: ["test"], typecheckCommands: ["types"] }));
  const violation = { id: "v", rule: "boundary", from: "a.ts", to: "b.ts", severity: "error", evidence: "edge", cyclePath: null };
  const snapshot = { schemaVersion: "1", root: "src", gitMarker: "before", configHash: "same", incompleteResolutionCount: 0, violations: [violation], modules: [],
    edges: [], scannerWarnings: [], scannerVersion: "test", timestamp: "2026-01-01T00:00:00Z" };
  const before = path.join(root, "before.json");
  fs.writeFileSync(before, json(snapshot));
  fs.writeFileSync(path.join(root, "after.json"), json({ ...snapshot, gitMarker: "after", violations: [] }));
  vi.mocked(getCase).mockResolvedValue({ snapshotPath: before, packet: {caseId:"case-001",scanId:"before",title:"boundary",rule:"boundary",severity:"error",
    violations:[violation],primaryFiles:["a.ts","b.ts"],relevantTests:[],testCommands:["test"],ruleExplanation:"boundary",expectedEndCondition:"resolve"},
    manifest: { policyHash: "policy", configPath: "rules.cjs", scope: "src" } } as never);
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
async function assertImportable(response: Awaited<ReturnType<typeof verifyCase>>) {
  const selected=await getCase(root,"case-001","before");
  const read=(file:string)=>JSON.parse(fs.readFileSync(file,"utf8"));
  const report=validateReport({before:read(selected.snapshotPath),packet:selected.packet,result:response.result,
    ...(response.afterSnapshotPath?{after:read(response.afterSnapshotPath)}:{}),
    ...(response.resultPath?{execution:read(path.join(path.dirname(response.resultPath),"execution.json"))}:{})});
  expect(report.result.status).toBe(response.result.status);
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
  await assertImportable(response);
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
  await assertImportable(response);
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

it.each(["waiting", "staging"])("invalidates evidence if inputs change while %s for publication", async phase => {
  let reads=0;
  vi.mocked(sourceState).mockImplementation(() => ++reads >= (phase === "waiting" ? 3 : 4) ? "changed" : "stable");
  vi.mocked(runScan).mockImplementation(async () => {
    await blockFinalPublication(); setTimeout(() => release?.(), 50);
    return { baselineId: "after.json" } as never;
  });
  const response=await verifyCase({repoRoot:root,baselineId:"before",caseId:"case-001"});
  await assertImportable(response);
  expect(response.result.status).toBe("invalid");
  expect(response.result.reason).toContain("stable workspace");
  expect(response.result.afterId).toBe("");
  expect(response.result.resolvedViolations).toEqual([]);
  expect(response.afterSnapshotPath).toBeUndefined();
  const execution=JSON.parse(fs.readFileSync(path.join(path.dirname(response.resultPath!),"execution.json"),"utf8"));
  expect(execution.afterSnapshotPath).toBeUndefined();
  expect(execution.diagnosticSnapshotPath).toBe(path.join(root,"after.json"));
  expect(JSON.parse(fs.readFileSync(response.resultPath!,"utf8"))).toEqual(response.result);
  expect(fs.existsSync(path.join(root,".archpulse/operation.lock"))).toBe(false);
  expect(fs.readdirSync(path.dirname(response.resultPath!)).sort()).toEqual(["execution.json","result.json","result.md"]);
});

it("keeps an unused fresh snapshot diagnostic-only when verification stops before comparison", async () => {
  vi.mocked(sourceState).mockReturnValueOnce("stable").mockReturnValue("changed");
  const response=await verifyCase({repoRoot:root,baselineId:"before",caseId:"case-001"});
  expect(response.result.status).toBe("invalid");
  expect(response.result.afterId).toBe("");
  expect(response.afterSnapshotPath).toBeUndefined();
  expect(JSON.parse(fs.readFileSync(path.join(path.dirname(response.resultPath!),"execution.json"),"utf8")).diagnosticSnapshotPath).toBe(path.join(root,"after.json"));
});
