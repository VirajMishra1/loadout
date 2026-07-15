import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettierConfig,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);
