import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { createGraphPreview } from "../../src/mcp/graph-preview.js";

test("generated graph preview renders and remains interactive in Chromium", async ({ page }) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-preview-browser-"));
  const root = path.join(temp,"project"), storage = path.join(temp,"state");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root,"a.js"),"import './b.js'; export const a=1;");
  fs.writeFileSync(path.join(root,"b.js"),"import './a.js'; export const b=2;");
  const preview = createGraphPreview();
  try {
    const output = execFileSync(process.execPath,["scripts/archpulse.js","scan","--repo",root,"--storage-base",storage],{encoding:"utf8",timeout:45000});
    const graph = output.match(/^Graph: (.+)$/m)![1]!;
    const url = await preview.add(fs.readFileSync(graph,"utf8"));
    const errors: string[] = [];
    page.on("pageerror",error=>errors.push(error.message));
    await page.goto(url);
    await expect(page.locator("svg")).toBeVisible();
    await expect(page.locator("g.node")).toHaveCount(2);
    await expect(page.locator("g.edge")).toHaveCount(2);
    await page.locator("g.node").first().hover();
    await expect(page.locator("g.node").first()).toHaveClass(/current/);
    await page.locator("g.node").first().click({button:"right"});
    await page.keyboard.press("Escape");
    await expect(page.locator(".current")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await preview.close();fs.rmSync(temp,{recursive:true,force:true}); }
});
