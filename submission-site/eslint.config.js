import tseslint from "typescript-eslint";
export default tseslint.config(
  { ignores: ["node_modules/**", "dist/**", "test-results/**", "playwright-report/**", ".vercel/**"] },
  ...tseslint.configs.recommended,
  { rules: { "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }] } },
);
