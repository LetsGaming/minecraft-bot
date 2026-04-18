module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    tsconfigRootDir: __dirname,
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
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
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
  },
  env: {
    node: true,
    es2022: true,
  },
  ignorePatterns: ["dist/", "node_modules/", "vitest.config.ts"],
};
