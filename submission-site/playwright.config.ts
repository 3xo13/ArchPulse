import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", timeout: 30_000, workers: 1,
  outputDir: "test-results",
  use: { browserName: "chromium", baseURL: "http://127.0.0.1:4198", trace: "retain-on-failure" },
  globalSetup: "./tests/server.ts",
});
