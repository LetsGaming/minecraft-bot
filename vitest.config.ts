import { defineConfig } from "vitest/config";
import { createRequire } from "module";
import path from "path";

// The Vue plugin is a dependency of the web workspace, not of the root, so it
// is resolved from there instead of wherever npm happened to hoist it.
const requireFromWeb = createRequire(path.resolve(__dirname, "src/web/package.json"));
const vue = requireFromWeb("@vitejs/plugin-vue");
const primevueDir = path.dirname(path.dirname(requireFromWeb.resolve("primevue/config")));

export default defineConfig({
  plugins: [vue()],
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
      // Component tests install PrimeVue from tests/, outside the web
      // workspace; pointing at the same files keeps one module instance.
      {
        find: /^primevue\/(.*)$/,
        replacement: path.join(primevueDir, "$1", "index.mjs"),
      },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    // Tests dynamically import large module graphs; the first run after a
    // change transforms them cold and can exceed vitest's 5 s default.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
