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

  it("pre-auth routes stay keyed by address: rotating state cookies buys nothing", async () => {
    const app = untrustedApp();
    for (let i = 0; i < 10; i++) {
      await app.inject({ method: "GET", url: "/auth/callback", headers: { cookie: `mcbot_oauth_state=n${i}` }, remoteAddress: "172.18.0.2" });
    }
    const res = await app.inject({ method: "GET", url: "/auth/callback", headers: { cookie: "mcbot_oauth_state=fresh" }, remoteAddress: "172.18.0.2" });
    expect(res.statusCode).toBe(429);
  });

  it("forged, malformed and rotated session cookies all share the address bucket", async () => {
    const app = untrustedApp();
    const { encodeSigned, SESSION_COOKIE } = await import("../../src/web/backend/auth/auth.js");
    const expired = encodeSigned({ uid: "999999999999999999", tag: "x", guilds: [], exp: Date.now() - 1 });
    const cookies = [
      `${SESSION_COOKIE}=garbage`,
      `${SESSION_COOKIE}=aaaa.bbbb`,
      `${SESSION_COOKIE}=${expired}`,
      "",
    ];
    const codes: number[] = [];
    for (let i = 0; i < 40; i++) {
      const cookie = i % 2 ? `${cookies[i % cookies.length]}${i}` : cookies[i % cookies.length]!;
      codes.push((await app.inject({ method: "POST", url: "/api/test", headers: cookie ? { cookie } : {}, remoteAddress: "172.18.0.2" })).statusCode);
    }
    expect(codes.slice(0, 30).every((c) => c === 200)).toBe(true);
    expect(codes.slice(30).every((c) => c === 429)).toBe(true);
  });

  it("1000 bogus session values do not need 1000 buckets", async () => {
    const app = untrustedApp();
    let limited = 0;
    for (let i = 0; i < 1000; i++) {
      const res = await app.inject({ method: "POST", url: "/api/test", headers: { cookie: `mcbot_session=bogus${i}.sig${i}` }, remoteAddress: "172.18.0.2" });
      if (res.statusCode === 429) limited++;
    }
    expect(limited).toBe(970);
  });

  it("the address ceiling trips for many real identities behind one address", async () => {
    const app = untrustedApp();
    let blocked = 0;
    for (let i = 0; i < 200; i++) {
      const cookie = await signedIn(`${100000000000000000n + BigInt(i)}`);
      const res = await app.inject({ method: "POST", url: "/api/test", headers: { cookie }, remoteAddress: "172.18.0.2" });
      if (res.statusCode === 429) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
    const other = await app.inject({ method: "POST", url: "/api/test", headers: { cookie: await signedIn("333333333333333333") }, remoteAddress: "198.51.100.8" });
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

describe("bucket map bound", () => {
  it("evicts the oldest buckets beyond maxBuckets", async () => {
    const { createRateLimiter } = await import("../../src/core/utils/rateLimiter.js");
    const limiter = createRateLimiter({ capacity: 1, windowMs: 60_000, maxBuckets: 3 });
    expect(limiter.consumeToken("k0")).toBe(true);
    expect(limiter.consumeToken("k0")).toBe(false);
    for (const k of ["k1", "k2", "k3"]) limiter.consumeToken(k);
    expect(limiter.consumeToken("k0")).toBe(true);
  });
});
