import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    // Map the workspace packages to their TypeScript sources so tests,
    // vi.mock() specifiers, and the code under test all resolve to the
    // same files without a build step.
    alias: [
      {
        find: /^@mcbot\/core\/(.*)$/,
        replacement: path.resolve(__dirname, "src/core/$1"),
      },
      {
        find: /^@mcbot\/schema\/(.*)$/,
        replacement: path.resolve(__dirname, "src/schema/$1"),
      },
      {
        find: /^@mcbot\/schema$/,
        replacement: path.resolve(__dirname, "src/schema/index.ts"),
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
  },
});
