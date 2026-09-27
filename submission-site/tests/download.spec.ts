import { test, expect } from "@playwright/test";
import { build, preview } from "vite";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

test("a separately built download is served as ZIP bytes and enables the button", async ({ page, request }) => {
  test.setTimeout(60_000);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "archpulse-site-download-"));
  const publicDir = path.join(temporary, "public");
  const outDir = path.join(temporary, "dist");
  // Empty ZIP end-of-central-directory record: a synthetic download, never a release.
  const bytes = Buffer.alloc(22); bytes.writeUInt32LE(0x06054b50);
  fs.mkdirSync(path.join(publicDir, "downloads"), { recursive: true });
  fs.writeFileSync(path.join(publicDir, "downloads/archpulse.zip"), bytes);
  let server: Awaited<ReturnType<typeof preview>> | undefined;
  try {
    await build({ publicDir, define: { __DOWNLOAD_FILENAME__: JSON.stringify("archpulse.zip") }, build: { outDir, emptyOutDir: true }, logLevel: "error" });
    server = await preview({ build: { outDir }, preview: { host: "127.0.0.1", port: 4199, strictPort: true } });
    await page.goto("http://127.0.0.1:4199/");
    const link = page.getByRole("link", { name: /Download for Bob/ });
    await expect(link).toBeVisible();
    const response = await request.get("http://127.0.0.1:4199/downloads/archpulse.zip");
    expect(response.status()).toBe(200); expect(await response.body()).toEqual(bytes);
    const downloadPromise = page.waitForEvent("download"); await link.click();
    expect((await downloadPromise).suggestedFilename()).toBe("archpulse.zip");
  } finally {
    if (server) {
      const http = server.httpServer;
      await new Promise<void>((resolve, reject) => { http.close(error => error ? reject(error) : resolve()); if ("closeAllConnections" in http) http.closeAllConnections(); });
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
