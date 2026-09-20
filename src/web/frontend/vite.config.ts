import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";

// Builds into src/web/dist/frontend, where the Fastify backend
// (src/web/dist/backend/server.js) serves it as static files — the same
// ../frontend relative shape the backend always used.
export default defineConfig({
  // The build runs from web-ui/ (workspace scripts), so pin the app root
  // to this directory — index.html lives here.
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [vue()],
  build: {
    outDir: "../dist/frontend",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:frontend -w web-ui` proxies API + auth to a locally
    // running backend (npm run start:web at the repo root). Target port
    // follows WEBUI_PORT so isolated dev sessions (scripts/dev-up.mjs) can
    // point each frontend at its own backend instance.
    proxy: (() => {
      const target = `http://localhost:${process.env.WEBUI_PORT ?? 8130}`;
      return {
        "/api": target,
        "/auth": target,
        "/healthz": target,
      };
    })(),
  },
});
