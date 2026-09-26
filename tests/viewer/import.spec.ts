import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

test("imports a real repaired repository into the production viewer", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-browser-"));
  const write = (name: string, content: string) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  const cli = (...args: string[]) => execFileSync(process.execPath, ["--import", "tsx/esm", "src/cli/index.ts", ...args, "--repo", root], { cwd: process.cwd(), encoding: "utf8", timeout: 45_000 });
  try {
    const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
    write("package.json", JSON.stringify({ name: "browser-demo", type: "module" }));
    write("config/architecture.json", JSON.stringify({ layers: [], forbiddenDependencies: [], scanScope: "src",
      testCommands: ['node --test "checks/test.cjs"'], typecheckCommands: [`node "${tsc}" --noEmit --allowJs --checkJs --skipLibCheck --target es2022 src/a.js src/b.js`] }));
    // Serialize the expressions as JSON to preserve the scanner's regex escapes.
    write(".dependency-cruiser.cjs", "module.exports=" + JSON.stringify({ forbidden: [{ name: "boundary", severity: "error", from: { path: "a\\.js$" }, to: { path: "b\\.js$" } }] }));
    write("src/a.js", 'import { b } from "./b.js"; export const a = b;'); write("src/b.js", "export const b = 1;");
    write("checks/test.cjs", 'const {test}=require("node:test"); const assert=require("node:assert/strict"); test("exports a",async()=>{const {a}=await import("../src/a.js");assert.equal(a,1)});');
    const output = cli("scan");
    const baseline = output.match(/Baseline: (.+)/)?.[1]?.trim(); expect(baseline).toBeTruthy();
    cli("cases", "--snapshot", baseline!);
    const beforePath = path.resolve(root, baseline!);
    const index = JSON.parse(fs.readFileSync(path.join(path.dirname(beforePath), "cases/index.json"), "utf8"));
    const caseId: string = index.cases[0].caseId;
    write("src/a.js", "export const a = 1;");
    const verified = cli("verify", "--before", baseline!, "--case", caseId, "--out", ".archpulse/result");
    expect(verified).toContain("verified:");
    const resultPath = path.join(root, ".archpulse/result/result.json");
    const executionPath = path.join(root, ".archpulse/result/execution.json");
    const execution = JSON.parse(fs.readFileSync(executionPath, "utf8"));
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto("/"); await expect(page.getByText("Example data", { exact: true })).toBeVisible();
    await page.getByText("Import verification results", { exact: true }).click();
    for (const [label, file] of [["Before snapshot", beforePath], ["After snapshot", execution.afterSnapshotPath],
      ["Case packet", path.join(path.dirname(beforePath), "cases", `${caseId}.json`)],
      ["Verification result", resultPath], ["Execution details (optional)", executionPath]]) {
      await page.getByLabel(label).setInputFiles(file);
    }
    await page.getByRole("button", { name: "Load report" }).click();
    await expect(page.getByText("Imported report", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: /boundary/ })).toBeVisible();
    await page.getByRole("button", { name: /^After \d+$/ }).click();
    await expect(page.getByText("✓ No violations", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /^Before \d+$/ }).click();
    await expect(page.getByText("1 violation present", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Show example" }).click();
    await expect(page.getByText("Example data", { exact: true })).toBeVisible();
    expect(errors).toEqual([]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
