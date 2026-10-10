/**
 * SEC-02 — the shared dashboard rate limiter. Exercised on a bare Fastify
 * instance (not the full buildServer) so the module-level buckets start fresh
 * and the boundaries are deterministic. A separate file gives it its own
 * module context, isolated from the route tests that also hit /auth/*.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => ({ webui: {}, adminUsers: [], servers: {}, guilds: {} })),
}));

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

describe("buckets behind one shared proxy address", () => {
  async function signedIn(uid: string): Promise<string> {
    const { encodeSigned, SESSION_COOKIE } = await import("../../src/web/backend/auth/auth.js");
    return `${SESSION_COOKIE}=${encodeSigned({ uid, tag: uid, guilds: [], exp: Date.now() + 60_000 })}`;
  }

  async function flood(app: FastifyInstance, method: "GET" | "POST", url: string, headers: Record<string, string>, n: number) {
    for (let i = 0; i < n; i++) await app.inject({ method, url, headers, remoteAddress: "172.18.0.2" });
  }

  function untrustedApp(): FastifyInstance {
    const app = Fastify({ logger: false, trustProxy: false });
    registerRateLimiting(app);
    app.post("/api/test", async () => ({ ok: true }));
    app.get("/auth/callback", async () => ({ ok: true }));
    app.get("/auth/test", async () => ({ ok: true }));
    return app;
  }

  it("a flooding user does not lock out another user on writes", async () => {
    const app = untrustedApp();
    const noisy = await signedIn("111111111111111111");
    const quiet = await signedIn("222222222222222222");
    await flood(app, "POST", "/api/test", { cookie: noisy }, 40);
    const blocked = await app.inject({ method: "POST", url: "/api/test", headers: { cookie: noisy }, remoteAddress: "172.18.0.2" });
    const other = await app.inject({ method: "POST", url: "/api/test", headers: { cookie: quiet }, remoteAddress: "172.18.0.2" });
    expect(blocked.statusCode).toBe(429);
    expect(other.statusCode).toBe(200);
  });

  it("separate login attempts keep separate callback buckets", async () => {
    const app = untrustedApp();
    await flood(app, "GET", "/auth/callback", { cookie: "mcbot_oauth_state=aaaa" }, 15);
    const blocked = await app.inject({ method: "GET", url: "/auth/callback", headers: { cookie: "mcbot_oauth_state=aaaa" }, remoteAddress: "172.18.0.2" });
    const other = await app.inject({ method: "GET", url: "/auth/callback", headers: { cookie: "mcbot_oauth_state=bbbb" }, remoteAddress: "172.18.0.2" });
    expect(blocked.statusCode).toBe(429);
    expect(other.statusCode).toBe(200);
  });

  it("a spoofed X-Forwarded-For does not buy a fresh bucket when no proxy is trusted", async () => {
    const app = untrustedApp();
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: "/auth/test", remoteAddress: "198.51.100.4", headers: { "x-forwarded-for": `203.0.113.${i}` } });
    }
    const res = await app.inject({ method: "GET", url: "/auth/test", remoteAddress: "198.51.100.4", headers: { "x-forwarded-for": "203.0.113.200" } });
    expect(res.statusCode).toBe(429);
  });
});
