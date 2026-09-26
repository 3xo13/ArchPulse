import { it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { runScan } from "../cli/scan.js";
import { validateWithinWorkspace } from "../core/workspace.js";

type Reply = { isError?: boolean; content: Array<{ text: string }> };
const handlers = vi.hoisted(() => new Map<string, (args: Record<string, string>) => Promise<Reply>>());
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({ McpServer: class {
  registerTool(name: string, _config: unknown, handler: (args: Record<string, string>) => Promise<Reply>) { handlers.set(name, handler); }
  async connect() {}
} }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({ StdioServerTransport: class {} }));
vi.mock("../cli/scan.js", () => ({ runScan: vi.fn() }));
vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) };
});
await import("./server.js");
const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
let temp: string;
let root: string;
beforeEach(() => {
  vi.mocked(fs.realpathSync).mockImplementation(actualFs.realpathSync);
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-workspace-"));
  root = path.join(temp, "repo"); fs.mkdirSync(root);
  vi.stubEnv("ARCHPULSE_ROOT", root);
  vi.mocked(runScan).mockReset().mockResolvedValue({ baselineId: "baseline/snapshot.json", snapshotPath: "out/snapshot.json", graphPath: "out/graph.html",
    violationCount: 0, errorCount: 0, warnCount: 0, violations: [], gitMarker: "abc", configHash: "hash",
    incompleteResolutionCount: 0, scannerWarnings: [] });
});
afterEach(() => { vi.unstubAllEnvs(); fs.rmSync(temp, { recursive: true, force: true }); });
const scan = (args: { workspacePath?: string; outDir?: string } = {}) => handlers.get("scan_repository")!(args as Record<string, string>);

it("uses the trusted root and allows a new nested output", async () => {
  expect((await scan({ outDir: "new/deep/out" })).isError).not.toBe(true);
  expect(runScan).toHaveBeenCalledWith(expect.objectContaining({ repoRoot: root, outDir: path.join(root, "new/deep/out"), workspaceOnly: true }));
});
it.each([{ workspacePath: ".." }, { outDir: "../escape" }])("rejects traversal before scanning %j", async args => {
  expect((await scan(args)).isError).toBe(true); expect(runScan).not.toHaveBeenCalled();
});
it("limits output to the selected subrepository", async () => {
  fs.mkdirSync(path.join(root, "sub"));
  expect((await scan({ workspacePath: "sub", outDir: "../other" })).isError).toBe(true);
  expect(runScan).not.toHaveBeenCalled();
});
it("rejects an unexpanded workspace variable with an actionable MCP error", async () => {
  vi.stubEnv("ARCHPULSE_ROOT", "${workspaceFolder}");
  const reply = await scan();
  expect(reply.isError).toBe(true); expect(reply.content[0]!.text).toContain("unexpanded");
  expect(runScan).not.toHaveBeenCalled();
});
it.each([false, true])("rejects directory links escaping the workspace (dangling: %s)", async dangling => {
  const target = path.join(temp, "outside");
  if (!dangling) fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(root, "link"), "junction");
  expect((await scan({ outDir: "link/new" })).isError).toBe(true);
  expect(runScan).not.toHaveBeenCalled();
});
it("validates artifact targets as well as output directories", async () => {
  const out = path.join(root, "out"); fs.mkdirSync(out);
  const outside = path.join(temp, "outside"); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(out, "snapshot.json"), "junction");
  expect((await scan({ outDir: "out" })).isError).toBe(true);
  expect(runScan).not.toHaveBeenCalled();
});
it("accepts a directory beginning with two dots inside the root", () => {
  fs.mkdirSync(path.join(root, "..valid"));
  expect(() => validateWithinWorkspace(path.join(root, "..valid"), root)).not.toThrow();
});
it.skipIf(process.platform !== "win32")("rejects other drives and UNC shares without querying the network", () => {
  const target = path.join(root, "target"); fs.mkdirSync(target);
  for (const [realRoot, realTarget] of [["C:\\repo", "D:\\other"], ["\\\\server-a\\share\\repo", "\\\\server-b\\share\\repo"]]) {
    vi.mocked(fs.realpathSync).mockReturnValueOnce(realRoot!).mockReturnValueOnce(realTarget!);
    expect(() => validateWithinWorkspace(target, root)).toThrow(/outside/);
  }
});
it("marks incomplete coverage and caps violations in the actual tool handler", async () => {
  const violations = Array.from({ length: 12 }, (_, i) => ({ id: `v${i}`, rule: "rule", from: "a", to: "b", severity: "error" }));
  vi.mocked(runScan).mockResolvedValueOnce({ baselineId: "baseline/snapshot.json", snapshotPath: "snapshot.json", graphPath: "graph.html",
    violationCount: 12, errorCount: 12, warnCount: 0, violations, gitMarker: "abc", configHash: "hash",
    incompleteResolutionCount: 2, scannerWarnings: ["Coverage incomplete"] });
  const text = (await scan()).content[0]!.text;
  expect(text).toContain("Scan incomplete"); expect(text).toContain("Coverage incomplete");
  expect(text).toContain("2 more violation"); expect(text).not.toContain("id:   v10");
});
it.each(["get_case", "verify_case"])("rejects %s with unavailable baseline", async name => {
  const reply = await handlers.get(name)!({ caseId: "case-001", baselineId: "baseline" });
  expect(reply.isError).toBe(true); expect(reply.content[0]!.text).toMatch(/failed|invalid/);
  expect(reply.content[0]!.text).not.toContain("npm run");
});
it("bounds UTF-8 summaries and reports truncation for oversized warnings",async()=>{
  vi.mocked(runScan).mockResolvedValueOnce({baselineId:"baseline/snapshot.json",snapshotPath:"snapshot.json",graphPath:"graph.html",
    violationCount:0,errorCount:0,warnCount:0,violations:[],gitMarker:"test",configHash:"hash",incompleteResolutionCount:1,
    scannerWarnings:["very long warning ".repeat(500)]});
  const response=(await scan()).content[0]!.text;
  expect(Buffer.byteLength(response)).toBeLessThanOrEqual(2048);expect(response).toContain("truncated");
  expect(response).toContain("Baseline: baseline/snapshot.json");
});
