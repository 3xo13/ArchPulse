import { it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { runScan } from "./scan.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
it("generates an offline interactive graph from the real CLI (no Vitest module rewriting)", { timeout: 30000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse graph & paths "));
  try {
    const loader = pathToFileURL(createRequire(import.meta.url).resolve("tsx/esm")).href;
    const result = spawnSync(process.execPath, ["--import", loader,
      path.join(repo, "src/cli/index.ts"), "scan", "--repo", ".", "--out", temp], {
      cwd: repo, encoding: "utf8", timeout: 25000,
      env: { ...process.env, PATH: path.dirname(process.execPath) },
    });
    expect(result.status, result.stderr).toBe(0);
    const html = fs.readFileSync(path.join(temp, "graph.html"), "utf8");
    expect(html).toContain("<svg");
    expect(html).toContain('class="node"');
    expect(html).toContain('class="edge"');
    expect(html).toContain("<script>");
    expect(html).toContain("highlight");
    expect(html).not.toMatch(/<(?:script|link)[^>]+(?:src|href)=["']https?:/);
    const snapshot = JSON.parse(fs.readFileSync(path.join(temp, "snapshot.json"), "utf8"));
    expect(snapshot.root).toBe("demo/packages");
    expect(snapshot.violations.map((v: { rule: string }) => v.rule).sort()).toEqual(["shared-no-domain", "ui-no-db"]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

it("resolves returned artifact paths on the temp drive", { timeout: 30000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-graph-"));
  try {
    const summary = await runScan({ repoRoot: repo, outDir: temp });
    expect(fs.existsSync(path.resolve(repo, summary.graphPath))).toBe(true);
    expect(fs.existsSync(path.resolve(repo, summary.snapshotPath))).toBe(true);
    expect(summary.incompleteResolutionCount).toBe(0);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

it("scans a real cycle and missing import in a separate workspace without a tsconfig", { timeout: 30000 }, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-cycle-"));
  try {
    fs.mkdirSync(path.join(temp, "src"));
    fs.writeFileSync(path.join(temp, ".dependency-cruiser.cjs"),
      'module.exports = { forbidden: [{ name: "no-circular", severity: "error", from: {}, to: { circular: true } }] };');
    fs.writeFileSync(path.join(temp, "src/a.js"), 'import "./b.js"; import "./missing.js"; export const a = 1;');
    fs.writeFileSync(path.join(temp, "src/b.js"), 'import "./a.js"; export const b = 2;');
    const summary = await runScan({ repoRoot: temp });
    expect(summary.incompleteResolutionCount).toBe(1);
    expect(summary.scannerWarnings.join(" ")).toContain("incomplete");
    const snapshot = JSON.parse(fs.readFileSync(path.resolve(temp, summary.snapshotPath), "utf8"));
    expect(snapshot.root).toBe("src");
    expect(snapshot.scannerVersion).toMatch(/^dependency-cruiser@\d/);
    expect(snapshot.violations.find((v: { rule: string }) => v.rule === "no-circular").cyclePath.sort())
      .toEqual(["src/a.js", "src/b.js"]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
