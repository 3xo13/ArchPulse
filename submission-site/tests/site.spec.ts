import { expect, test } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("reviewer completes the recorded journey and returns to the overview", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Repair with evidence");
  await page.screenshot({ path: "test-results/landing-desktop.png", fullPage: true });
  await page.getByRole("link", { name: /Explore interactive demo/ }).click();
  await expect(page.getByText("Recorded example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Inspect demo/packages/ui/src/orderService.ts" }).click();
  await page.getByRole("button", { name: /OUT demo\/packages\/db\/src\/index.ts/ }).click();
  await expect(page.locator('path[data-selected="true"]')).toHaveCount(1);
  await page.getByLabel("Violations only").check();
  await expect(page.getByRole("button", { name: "Inspect demo/packages/shared/src/types.ts" })).toHaveCount(0);
  await page.getByRole("button", { name: "Reset selection" }).click();
  await expect(page.getByRole("region", { name: "File inspector" })).toHaveCount(0);
  await page.getByRole("button", { name: /Next: Repair case/ }).click();
  await expect(page.getByRole("heading", { name: "UI layer imports directly from db (forbidden boundary)" })).toBeVisible();
  await page.getByRole("button", { name: /Next: Repair outcome/ }).click();
  await page.getByRole("button", { name: "After", exact: true }).click();
  await expect(page.getByText("1 repository-wide violations · after snapshot")).toBeVisible();
  await page.getByText(/Inspect dependency changes/).click();
  await expect(page.getByText("− Removed", { exact: true })).toHaveCount(2);
  await page.screenshot({ path: "test-results/demo-outcome-desktop.png", fullPage: true });
  await page.getByRole("button", { name: /Next: Verification evidence/ }).click();
  await page.getByText("Recorded test commands and full output").click();
  await expect(page.getByText(/1 unrelated baseline violation remains/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Passed", exact: true })).toHaveCount(2);
  await page.getByRole("link", { name: "← Back to overview" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Understand the");
  expect(errors).toEqual([]);
});

test("imports reports locally, preserves a valid import on rejection, and restores the example", async ({ page }) => {
  const external: string[] = [];
  page.on("request", request => { if (!request.url().startsWith("http://127.0.0.1:4198")) external.push(request.url()); });
  await page.goto("/#/demo");
  await page.getByText("Open your own ArchPulse report (optional)").click();
  for (const [label, filename] of [["Before snapshot", "snapshot-before.json"], ["After snapshot", "snapshot-after.json"], ["Case packet", "case-001.json"], ["Verification result", "result.json"]]) {
    await page.getByLabel(label!).setInputFiles(fileURLToPath(new URL(`../src/fixtures/${filename}`, import.meta.url)));
  }
  await page.getByRole("button", { name: "Load report" }).click();
  await expect(page.getByText("Imported report", { exact: true })).toBeVisible();
  await page.getByLabel("Verification result").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from("null") });
  await page.getByRole("button", { name: "Load report" }).click();
  await expect(page.getByRole("alert")).toContainText("Verification result");
  await expect(page.getByText("Imported report", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show example" }).click();
  await expect(page.getByText("Recorded example", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});

test("direct links, history, keyboard selection and reduced motion work", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#/demo"); await page.reload();
  const node = page.getByRole("button", { name: "Inspect demo/packages/ui/src/orderService.ts" });
  await node.focus(); await page.keyboard.press("Enter");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "← Back to overview" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Understand");
  await page.goBack(); await expect(page.getByRole("heading", { name: /Follow the evidence/ })).toBeVisible();
  await page.goForward(); await expect(page.getByRole("heading", { level: 1 })).toContainText("Understand");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
});

test("mobile layout and Bob installation instructions stay readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/landing-mobile.png", fullPage: true });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Install for Bob" }).click();
  await expect(page.getByRole("heading", { name: "Install in Bob IDE" })).toBeVisible();
  await expect(page.getByText(/npm ci --include=dev --ignore-scripts/)).toBeVisible();
  await page.getByText("Ready to verify a repair? Approve your project’s checks first.").click();
  await expect(page.getByText(/--approve "YOUR_PROPOSAL_ID"/)).toBeVisible();
  await page.goto("/#/demo");
  await expect(page.getByRole("heading", { name: /Follow the evidence/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/demo-mobile.png", fullPage: true });
});

test("the supplied archive downloads unchanged from the production page", async ({ page, request }) => {
  const filename = ["ArchPulse.rar", "archpulse.zip"].find(name => existsSync(fileURLToPath(new URL(`../public/downloads/${name}`, import.meta.url))));
  test.skip(!filename, "No installation archive has been supplied.");
  await page.goto("/");
  const link = page.getByRole("link", { name: /Download for Bob/ });
  await expect(link).toHaveAttribute("download", filename!);
  const response = await request.get(`/downloads/${filename}`);
  expect(response.status()).toBe(200);
  const original = readFileSync(fileURLToPath(new URL(`../public/downloads/${filename}`, import.meta.url)));
  const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
  expect(digest(await response.body())).toBe(digest(original));
});
