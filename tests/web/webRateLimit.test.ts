/**
 * SEC-02 — the shared dashboard rate limiter. Exercised on a bare Fastify
 * instance (not the full buildServer) so the module-level buckets start fresh
 * and the boundaries are deterministic. A separate file gives it its own
 * module context, isolated from the route tests that also hit /auth/*.
 */
import { describe, it, expect } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";

import Fastify, { type FastifyInstance } from "fastify";
import { registerRateLimiting } from "../../src/web/backend/rateLimit.js";

function appWithRoutes(): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: true });
  registerRateLimiting(app);
  app.get("/auth/test", async () => ({ ok: true }));
  app.get("/api/test", async () => ({ ok: true }));
  app.post("/api/test", async () => ({ ok: true }));
  return app;
}

async function statuses(
  app: FastifyInstance,
  method: "GET" | "POST",
  url: string,
  n: number,
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((await app.inject({ method, url })).statusCode);
  }
  return out;
}

describe("dashboard rate limiting (SEC-02)", () => {
  it("caps /auth/* per IP and sets Retry-After on the 429", async () => {
    const app = appWithRoutes();
    // authLimiter capacity is 10/60s; the injected IP is constant.
    const passed = await statuses(app, "GET", "/auth/test", 10);
    expect(passed.every((s) => s === 200)).toBe(true);

    const limited = await app.inject({ method: "GET", url: "/auth/test" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(JSON.parse(limited.body).error).toMatch(/too many requests/i);
  });

  it("caps mutating /api/* requests", async () => {
    const app = appWithRoutes();
    // apiWriteLimiter capacity is 30/60s.
    const passed = await statuses(app, "POST", "/api/test", 30);
    expect(passed.every((s) => s === 200)).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/test" })).statusCode).toBe(429);
  });

  it("never limits read-only GET /api/* requests", async () => {
    const app = appWithRoutes();
    const all = await statuses(app, "GET", "/api/test", 40);
    expect(all.every((s) => s === 200)).toBe(true);
  });
});
