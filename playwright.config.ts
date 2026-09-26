import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/viewer",
  timeout: 120_000,
  workers: 1,
  outputDir: ".archpulse/browser-tests",
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:4197", trace: "retain-on-failure" },
  globalSetup: "./tests/viewer/server.ts",
});
