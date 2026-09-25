import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["demo/packages/*/src/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
