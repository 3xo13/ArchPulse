import { it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runProcess } from "../core/process.js";
import { instance } from "@viz-js/viz";
import { runScan } from "./scan.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "") }));
vi.mock("../core/process.js", () => ({ runProcess: vi.fn() }));
vi.mock("dependency-cruiser", () => ({ format: vi.fn(async () => ({ output: "digraph {}", exitCode: 0 })) }));
vi.mock("@viz-js/viz", () => ({ instance: vi.fn(async () => ({ renderString: () => "<svg></svg>" })) }));
let temp: string;
const raw = () => ({ modules: [{ source: "src/a.ts", dependencies: [] }], summary: { violations: [] } });
function result(stdout: string, status = 0) {
  return { output: stdout, stdout, stderr: "", exitCode: status, stopped: false };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(instance).mockResolvedValue({ renderString: () => "<svg></svg>" } as unknown as Awaited<ReturnType<typeof instance>>);
  vi.mocked(runProcess).mockImplementation(async (_file, args) => result(
    String(args?.[0]).endsWith("wrap-stream-in-html.mjs") ? "<html><svg></svg></html>" : JSON.stringify(raw())));
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-scan-"));
  fs.writeFileSync(path.join(temp, ".dependency-cruiser.cjs"), "module.exports = {};");
});
afterEach(() => fs.rmSync(temp, { recursive: true, force: true }));

it("uses relative scope and the bundled version in an external repo without dependencies", async () => {
  const summary = await runScan({ repoRoot: temp });
  const snapshot = JSON.parse(fs.readFileSync(path.resolve(temp, summary.snapshotPath), "utf8"));
  expect(snapshot.root).toBe("src");
  expect(snapshot.scannerVersion).toMatch(/^dependency-cruiser@\d/);
  const call = vi.mocked(runProcess).mock.calls[0]!;
  expect(call[0]).toBe(process.execPath);
  expect(call[1]).toContain(path.join(temp, "src"));
  expect(call[2]).toMatchObject({ cwd: temp });
});
it.each([
  ["not-json", 0, "invalid JSON"], ["{}", 0, "Invalid dependency-cruiser result"],
  [JSON.stringify(raw()), 1, "without error violations"],
  [JSON.stringify(raw()), 2, "execution failed"],
])("rejects invalid scanner output/status %s %s", async (stdout, status, message) => {
  vi.mocked(runProcess).mockResolvedValueOnce(result(stdout, status));
  await expect(runScan({ repoRoot: temp })).rejects.toThrow(message);
  expect(fs.existsSync(path.join(temp, ".archpulse/latest/snapshot.json"))).toBe(false);
});
it("rejects process errors even with valid stdout", async () => {
  vi.mocked(runProcess).mockResolvedValueOnce({ ...result("", 1), stderr: "spawn error: launch failed" });
  await expect(runScan({ repoRoot: temp })).rejects.toThrow(/launch failed/);
});
it.each(["scanner","graph"])("rejects truncated %s output without publishing a baseline",async stage=>{
  if(stage==="scanner")vi.mocked(runProcess).mockResolvedValueOnce({...result(JSON.stringify(raw())),truncated:true});
  else vi.mocked(runProcess).mockResolvedValueOnce(result(JSON.stringify(raw())))
    .mockResolvedValueOnce({...result("<svg>incomplete"),truncated:true});
  await expect(runScan({repoRoot:temp})).rejects.toThrow(stage==="scanner"?/execution failed/:/wrapper failed/);
  expect(fs.existsSync(path.join(temp,".archpulse/latest-baseline.json"))).toBe(false);
});
it("accepts exit 1 only with real error violations and reports unresolved edges", async () => {
  const data = { modules: [{ source: "src/a.ts", dependencies: [{ resolved: "missing", couldNotResolve: true }] }],
    summary: { violations: [{ from: "src/a.ts", to: "src/b.ts", rule: { name: "boundary", severity: "error" } }] } };
  vi.mocked(runProcess).mockResolvedValueOnce(result(JSON.stringify(data), 1));
  const summary = await runScan({ repoRoot: temp });
  expect(summary.errorCount).toBe(1);
  expect(summary.incompleteResolutionCount).toBe(1);
  expect(summary.scannerWarnings.join(" ")).toContain("incomplete");
});
it("preserves both old artifacts when rendering fails", async () => {
  const out = path.join(temp, "out"); fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, "snapshot.json"), "old snapshot");
  fs.writeFileSync(path.join(out, "graph.html"), "old graph");
  vi.mocked(instance).mockRejectedValueOnce(new Error("WASM failed"));
  await expect(runScan({ repoRoot: temp, outDir: out })).rejects.toThrow(/Viz.js failed/);
  expect(fs.readFileSync(path.join(out, "snapshot.json"), "utf8")).toBe("old snapshot");
  expect(fs.readFileSync(path.join(out, "graph.html"), "utf8")).toBe("old graph");
  expect(fs.readdirSync(out).sort()).toEqual(["graph.html", "snapshot.json"]);
});
