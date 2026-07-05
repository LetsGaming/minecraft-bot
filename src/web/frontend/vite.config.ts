import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// Builds into dist/web/frontend of the ROOT project, where the Fastify
// backend (dist/web/backend/server.js) serves it as static files.
export default defineConfig({
  plugins: [vue()],
  build: {
    outDir: "../../../dist/web/frontend",
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` inside src/web/frontend proxies API + auth to a
    // locally running backend (npm run start:web).
    proxy: {
      "/api": "http://localhost:8130",
      "/auth": "http://localhost:8130",
      "/healthz": "http://localhost:8130",
    },
  },
});
