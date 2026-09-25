// @ts-check
import js from "@eslint/js";

/** @type {import("eslint").Linter.Config[]} */
export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off"
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module"
    }
  },
  {
    ignores: ["dist/**", "node_modules/**", "demo/**"]
  }
];
