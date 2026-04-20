import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // Golden Rule 1 — no direct console calls in production code
      "no-console": "error",

      // Catch unawaited async calls in Discord event handlers
      "@typescript-eslint/no-floating-promises": "error",

      // Prefer type-only imports where possible
      "@typescript-eslint/consistent-type-imports": "error",

      // Warn on any — don't block but flag for review
      "@typescript-eslint/no-explicit-any": "warn",

      // Allow unused vars prefixed with _ (intentional ignore pattern)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],

      // Warn on calls to @deprecated-tagged functions (catches shim usage)
      "@typescript-eslint/no-deprecated": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "vitest.config.ts"],
  },
];
