import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

const SRC_GLOBS = [
  "src/bot/**/*.ts",
  "src/web/backend/**/*.ts",
  "src/core/**/*.ts",
  "src/schema/**/*.ts",
];

export default [
  {
    files: SRC_GLOBS,
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        // Typed linting across all four workspaces — projectService picks
        // each file's own tsconfig (the root one is solution-style).
        projectService: true,
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
    // Layer boundary: src/core and src/schema import nothing from
    // src/bot or src/web. Bot and web both import the packages; nothing
    // else crosses (the
    // workspace layout makes this the natural direction — these rules
    // catch relative-path escapes like ../../bot/src/...).
    files: ["src/core/**/*.ts", "src/schema/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/bot/**", "**/src/web/**", "@mcbot/bot*", "@mcbot/web*"],
              message:
                "src/core and src/schema must not import from src/bot or src/web — move the Discord/HTTP half out or split the module (see docs/dev/architecture.md).",
            },
          ],
        },
      ],
    },
  },
  {
    // src/schema stays isomorphic: the browser bundles it.
    files: ["src/schema/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/src/bot/**", "**/src/web/**", "@mcbot/bot*", "@mcbot/web*",
                "@mcbot/core*",
                "node:*", "fs", "path", "crypto", "os", "child_process",
              ],
              message:
                "@mcbot/schema is imported by the browser frontend — types and pure contracts only, no Node built-ins, no other workspaces.",
            },
          ],
        },
      ],
    },
  },
  {
    // The web process talks to the bot only through the shared store and
    // store — never by importing bot modules (independent lifecycles).
    // The reverse holds too: the bot never references its extension.
    files: ["src/web/backend/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/bot/**", "@mcbot/bot*"],
              message:
                "src/web must not import from src/bot — the processes have independent lifecycles; share code via @mcbot/core or @mcbot/schema.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/bot/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/src/web/**", "@mcbot/web*"],
              message:
                "src/bot must not import from src/web — the dashboard is an optional extension; the bot cannot depend on it.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      "**/dist/",
      "node_modules/",
      "vitest.config.ts",
      "src/web/frontend/",
    ],
  },
];
