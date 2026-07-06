/**
 * Static Vue frontend serving — the not-found handler that turns every
 * unmatched GET into a file read from src/web/dist/frontend, with SPA
 * fallback to index.html. Split out of server.ts in the QUAL-01
 * refactor (2026-07 audit).
 *
 * This module must stay directly in backend/ (not routes/): frontendDir
 * resolves relative to the COMPILED file location
 * (dist/backend/static.js -> dist/frontend), same as server.js before
 * the split.
 */
import type { FastifyInstance } from "fastify";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".map": "application/json",
  ".woff2": "font/woff2",
};

function frontendDir(): string {
  // src/web/dist/backend/static.js → src/web/dist/frontend
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "frontend");
}

export function registerStaticFrontend(app: FastifyInstance): void {
  // ── Static frontend (everything unmatched) ──
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== "GET" || req.url.startsWith("/api")) {
      return reply.code(404).send({ error: "not found" });
    }
    const dir = frontendDir();
    // Path traversal guard: resolve and require the dir prefix.
    const urlPath = req.url.split("?")[0] ?? "/";
    const rel = urlPath === "/" ? "index.html" : urlPath.slice(1);
    const file = path.resolve(dir, rel);
    if (!file.startsWith(dir + path.sep) && file !== path.resolve(dir, "index.html")) {
      return reply.code(404).send({ error: "not found" });
    }
    const target = fs.existsSync(file) && fs.statSync(file).isFile()
      ? file
      : path.resolve(dir, "index.html"); // SPA fallback
    if (!fs.existsSync(target)) {
      return reply
        .code(503)
        .send("Frontend not built — run: npm run build:web");
    }
    const type = CONTENT_TYPES[path.extname(target)] ?? "application/octet-stream";
    return reply.header("content-type", type).send(fs.readFileSync(target));
  });
}
