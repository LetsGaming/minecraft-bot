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
    // Layer boundary: src/common imports nothing from src/bot or src/web.
    // Bot and web both import common; nothing else crosses (see
    // docs/dev/dashboard-and-features-plan.md — structure that cannot
    // drift silently, same idea as the single config write path).
    files: ["src/common/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/bot/**", "**/web/**"],
              message:
                "src/common must not import from src/bot or src/web — move the Discord/HTTP half out or split the module (see dashboard-and-features-plan.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // The web backend talks to the bot only through files and stores —
    // never by importing bot modules (independent lifecycles).
    files: ["src/web/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/bot/**"],
              message:
                "src/web must not import from src/bot — the processes have independent lifecycles; share code via src/common.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "vitest.config.ts", "src/web/frontend/"],
  },
];
