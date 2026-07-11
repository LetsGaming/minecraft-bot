/**
 * webBackend.test.ts — dashboard backend units + route behaviour.
 *
 * Covers: HMAC session tokens (round-trip, tamper, expiry), the admin
 * ID gate, secret redaction + placeholder merge-back, and the Fastify
 * routes via inject (auth gate on /api, healthz, metrics, config PUT
 * validation path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";

const mockConfig = {
  token: "real-bot-token",
  clientId: "123456789012345678",
  adminUsers: ["111111111111111111", "admin-role-name"],
  servers: {
    smp: { rconPassword: "hunter2", apiKey: "k-123" },
  },
  guilds: {
    "222222222222222222": { adminUsers: ["333333333333333333"] },
  },
  webui: { enabled: true, port: 8130 },
};

vi.mock("../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp"]),
}));

vi.mock("../src/core/utils/configService.js", () => ({
  readRawConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  validateCandidate: vi.fn(() => ({ valid: true, errors: [], warnings: ["w1"] })),
  writeConfig: vi.fn(async () => {}),
  configFileHash: vi.fn(() => "hash-1"),
}));

vi.mock("../src/core/utils/server.js", () => ({
  getServerInstance: vi.fn(() => null),
  getAllInstances: vi.fn(() => []),
}));

vi.mock("../src/core/utils/serverAccess.js", () => ({
  runScript: vi.fn(),
  tailLog: vi.fn(),
  listStatsUuids: vi.fn(),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(),
  readUserCache: vi.fn(),
}));

vi.mock("../src/core/utils/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(async () => ({ sparkline: "" })),
}));

vi.mock("../src/core/utils/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => [
    { at: "2026-01-01", action: "kick", server: "smp", by: "a", byId: "1", guildId: null },
  ]),
  recordAdminAction: vi.fn(async () => {}),
}));

vi.mock("../src/core/utils/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));

vi.mock("../src/core/utils/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => ({
    at: Date.now(),
    startedAt: Date.now() - 1000,
    pid: 1,
    version: "test",
  })),
  heartbeatIsFresh: vi.fn(() => true),
}));

vi.mock("../src/core/utils/playerCountHistory.js", () => ({
  loadPlayerCountStore: vi.fn(async () => ({ version: 1, servers: {} })),
}));

vi.mock("../src/core/utils/commandManifest.js", () => ({
  readCommandManifest: vi.fn(async () => ({
    slash: [{ name: "say", description: "s" }],
    ingame: [{ name: "vote", description: "v" }],
    updatedAt: 1,
  })),
}));

import {
  encodeSigned,
  decodeSigned,
  globalAdminIds,
  SESSION_COOKIE,
} from "../src/web/backend/auth.js";
import {
  toSafeConfig,
  mergeSecretPlaceholders,
  SECRET_PLACEHOLDER,
} from "../src/web/backend/safeConfig.js";
import { buildServer } from "../src/web/backend/server.js";
import type { RawBotConfig } from "../src/core/types/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Signed tokens ───────────────────────────────────────────────────────────

describe("signed session tokens", () => {
  it("round-trips a payload", () => {
    const token = encodeSigned({ uid: "1", exp: Date.now() + 1000 });
    expect(decodeSigned<{ uid: string }>(token)?.uid).toBe("1");
  });

  it("rejects tampered payloads", () => {
    const token = encodeSigned({ uid: "1" });
    const [payload, mac] = token.split(".") as [string, string];
    const forged =
      Buffer.from(JSON.stringify({ uid: "2" })).toString("base64url") +
      "." +
      mac;
    expect(decodeSigned(forged)).toBeNull();
    expect(decodeSigned(payload)).toBeNull(); // missing mac
    expect(decodeSigned(undefined)).toBeNull();
  });
});

describe("globalAdminIds (sysadmins)", () => {
  it("collects TOP-LEVEL user-ID entries only, not per-guild or role names", () => {
    const ids = globalAdminIds();
    expect(ids.has("111111111111111111")).toBe(true); // top-level adminUser
    expect(ids.has("333333333333333333")).toBe(false); // per-guild admin — NOT a sysadmin
    expect(ids.has("admin-role-name")).toBe(false); // not a snowflake
  });
});

// ── Safe config ─────────────────────────────────────────────────────────────

describe("toSafeConfig / mergeSecretPlaceholders", () => {
  const raw = mockConfig as unknown as RawBotConfig;

  it("masks token and per-server secrets", () => {
    const safe = toSafeConfig(raw);
    expect(safe.token).toBe(SECRET_PLACEHOLDER);
    const server = safe.servers!.smp as unknown as Record<string, string>;
    expect(server.rconPassword).toBe(SECRET_PLACEHOLDER);
    expect(server.apiKey).toBe(SECRET_PLACEHOLDER);
    // The original is untouched.
    expect(raw.token).toBe("real-bot-token");
  });

  it("swaps placeholders back for on-disk values on save", () => {
    const submitted = toSafeConfig(raw);
    const merged = mergeSecretPlaceholders(submitted, raw);
    expect(merged.token).toBe("real-bot-token");
    const server = merged.servers!.smp as unknown as Record<string, string>;
    expect(server.rconPassword).toBe("hunter2");
  });

  it("keeps a newly typed secret", () => {
    const submitted = toSafeConfig(raw);
    submitted.token = "brand-new-token";
    const merged = mergeSecretPlaceholders(submitted, raw);
    expect(merged.token).toBe("brand-new-token");
  });

  it("drops placeholders that have no current value", () => {
    const submitted = toSafeConfig(raw);
    (submitted.servers!.smp as unknown as Record<string, unknown>).apiKey =
      SECRET_PLACEHOLDER;
    const current = JSON.parse(JSON.stringify(raw)) as RawBotConfig;
    delete (current.servers!.smp as unknown as Record<string, unknown>).apiKey;
    const merged = mergeSecretPlaceholders(submitted, current);
    expect(
      (merged.servers!.smp as unknown as Record<string, unknown>).apiKey,
    ).toBeUndefined();
  });
});

// ── Routes ──────────────────────────────────────────────────────────────────

function adminCookie(): string {
  const session = encodeSigned({
    uid: "111111111111111111",
    tag: "admin#1",
    guilds: [],
    exp: Date.now() + 60_000,
  });
  return `${SESSION_COOKIE}=${session}`;
}

describe("web routes", () => {
  it("healthz responds without auth", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ web: "ok", bot: "ok" });
    await app.close();
  });

  it("sets security headers on responses (SEC-01)", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    const csp = res.headers["content-security-policy"];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // PrimeVue inline styles and Discord CDN avatars must be allowed.
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("cdn.discordapp.com");
    // TLS is the reverse proxy's job — don't force upgrades at the app.
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["strict-transport-security"]).toBeDefined();
    await app.close();
  });

  it("metrics respond without auth in Prometheus format", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("mcbot_bot_up 1");
    await app.close();
  });

  it("rejects unauthenticated /api requests", async () => {
    const app = buildServer();
    for (const url of ["/api/status", "/api/config", "/api/audit"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });

  /**
   * Route-table parity: every /api route must (a) still be registered — an
   * unregistered /api path falls into the static not-found handler and
   * returns 404, not 401 — and (b) sit behind a session gate (the sysadmin
   * scope or the logged-in scope). Without a cookie, both return 401.
   */
  it("registers the complete gated route table (auth parity)", async () => {
    const app = buildServer();
    const gated: Array<[string, string]> = [
      ["GET", "/api/status"],
      ["GET", "/api/uptime/smp"],
      ["GET", "/api/activity/smp"],
      ["GET", "/api/audit"],
      ["GET", "/api/config"],
      ["GET", "/api/config/schema"],
      ["PUT", "/api/config"],
      ["GET", "/api/commands"],
      ["POST", "/api/servers/smp/restart"],
      ["GET", "/api/servers/smp/log"],
      ["POST", "/api/servers/smp/prune-stats"],
      // Guild-manager scope (logged-in gate) — also 401 without a cookie.
      ["GET", "/api/setup/guilds"],
      ["GET", "/api/setup/servers"],
      ["GET", "/api/guilds"],
      ["GET", "/api/guilds/222222222222222222/config"],
      ["PUT", "/api/guilds/222222222222222222/config"],
    ];
    for (const [method, url] of gated) {
      const res = await app.inject({ method: method as "GET", url });
      expect(`${method} ${url} → ${res.statusCode}`).toBe(
        `${method} ${url} → 401`,
      );
    }
    // Public surface: exists and is NOT behind the session gate.
    expect((await app.inject({ url: "/auth/login" })).statusCode).toBe(302);
    expect(
      (await app.inject({ method: "POST", url: "/auth/logout" })).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: "/auth/callback" })).statusCode).toBe(400);
    expect((await app.inject({ url: "/api/me" })).statusCode).toBe(401);
    expect((await app.inject({ url: "/healthz" })).statusCode).toBe(200);
    await app.close();
  });

  it("logs in any Discord user but forbids non-sysadmins from server data", async () => {
    const app = buildServer();
    const stranger =
      `${SESSION_COOKIE}=` +
      encodeSigned({ uid: "999999999999999999", tag: "x", guilds: [], exp: Date.now() + 60_000 });
    // A valid signed cookie is a logged-in user, whoever they are.
    const me = await app.inject({ method: "GET", url: "/api/me", headers: { cookie: stranger } });
    expect(me.statusCode).toBe(200);
    expect(me.json().sysadmin).toBe(false);
    // But server status and the full config are sysadmin-only → 403, not 401.
    expect(
      (await app.inject({ method: "GET", url: "/api/status", headers: { cookie: stranger } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/config", headers: { cookie: stranger } })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: "GET", url: "/api/setup/servers", headers: { cookie: stranger } })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it("scopes guild config to the guilds a manager actually manages", async () => {
    const app = buildServer();
    const mgr =
      `${SESSION_COOKIE}=` +
      encodeSigned({
        uid: "444444444444444444",
        tag: "mgr",
        guilds: ["222222222222222222"],
        exp: Date.now() + 60_000,
      });
    // Their guild: readable.
    expect(
      (await app.inject({ method: "GET", url: "/api/guilds/222222222222222222/config", headers: { cookie: mgr } })).statusCode,
    ).toBe(200);
    // A guild they don't manage: forbidden.
    expect(
      (await app.inject({ method: "GET", url: "/api/guilds/999999999999999999/config", headers: { cookie: mgr } })).statusCode,
    ).toBe(403);
    // No writing to a guild they don't manage either.
    expect(
      (await app.inject({
        method: "PUT",
        url: "/api/guilds/999999999999999999/config",
        headers: { cookie: mgr, "content-type": "application/json" },
        payload: { baseHash: "hash-1", guildConfig: {} },
      })).statusCode,
    ).toBe(403);
    // And still no server data.
    expect(
      (await app.inject({ method: "GET", url: "/api/status", headers: { cookie: mgr } })).statusCode,
    ).toBe(403);
    await app.close();
  });

  it("gives a sysadmin every guild's config and the server list", async () => {
    const app = buildServer();
    expect(
      (await app.inject({ method: "GET", url: "/api/guilds/999999999999999999/config", headers: { cookie: adminCookie() } })).statusCode,
    ).toBe(200);
    const servers = await app.inject({ method: "GET", url: "/api/setup/servers", headers: { cookie: adminCookie() } });
    expect(servers.statusCode).toBe(200);
    expect(servers.json().servers).toContain("smp");
    await app.close();
  });

  it("serves status and redacted config to an admin session", async () => {
    const app = buildServer();
    const status = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { cookie: adminCookie() },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json().bot.alive).toBe(true);

    const config = await app.inject({
      method: "GET",
      url: "/api/config",
      headers: { cookie: adminCookie() },
    });
    expect(config.statusCode).toBe(200);
    // { hash, config } — the hash is the optimistic-concurrency baseline.
    expect(config.json().hash).toBe("hash-1");
    expect(config.json().config.token).toBe(SECRET_PLACEHOLDER);
    await app.close();
  });

  it("PUT /api/config merges placeholders and writes on valid input", async () => {
    const { writeConfig, validateCandidate } = await import(
      "../src/core/utils/configService.js"
    );
    const app = buildServer();
    const submitted = toSafeConfig(mockConfig as unknown as RawBotConfig);

    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { cookie: adminCookie(), "content-type": "application/json" },
      payload: { baseHash: "hash-1", config: submitted },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, warnings: ["w1"] });

    // The placeholder never reaches disk — the merge restored the token.
    const written = vi.mocked(writeConfig).mock.calls[0]![0] as RawBotConfig;
    expect(written.token).toBe("real-bot-token");
    expect(vi.mocked(validateCandidate)).toHaveBeenCalled();
    await app.close();
  });

  it("PUT /api/config returns 422 with errors on invalid input", async () => {
    const { validateCandidate, writeConfig } = await import(
      "../src/core/utils/configService.js"
    );
    vi.mocked(validateCandidate).mockReturnValueOnce({
      valid: false,
      errors: ["  - bad thing"],
      warnings: [],
    });
    const app = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { cookie: adminCookie(), "content-type": "application/json" },
      payload: { baseHash: "hash-1", config: {} },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual(["  - bad thing"]);
    expect(vi.mocked(writeConfig)).not.toHaveBeenCalled();
    await app.close();
  });

  it("PUT /api/config returns 409 when config.json changed underneath the editor", async () => {
    const { writeConfig } = await import(
      "../src/core/utils/configService.js"
    );
    const app = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { cookie: adminCookie(), "content-type": "application/json" },
      payload: { baseHash: "stale-hash", config: {} },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("conflict");
    expect(res.json().currentHash).toBe("hash-1");
    expect(vi.mocked(writeConfig)).not.toHaveBeenCalled();
    await app.close();
  });

  it("serves the command matrix to an admin session", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/commands",
      headers: { cookie: adminCookie() },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.manifest.slash[0].name).toBe("say");
    expect(body.scopes.serverIds).toEqual(["smp"]);
    // Effective policies exist for every scope key.
    expect(body.effective.say.global).toEqual({
      enabled: true,
      adminOnly: false,
    });
    expect(body.effective.vote["server:smp"]).toBeDefined();
    await app.close();
  });

  it("404s ops routes for unknown servers", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/servers/nope/restart",
      headers: { cookie: adminCookie() },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});

describe("guild-scope freshness on writes (SEC-03)", () => {
  const managedGuild = "222222222222222222";
  const putBody = { baseHash: "hash-1", guildConfig: {} };
  function mgrCookie(gexp?: number): string {
    return (
      `${SESSION_COOKIE}=` +
      encodeSigned({
        uid: "444444444444444444",
        tag: "mgr",
        guilds: [managedGuild],
        exp: Date.now() + 60_000,
        ...(gexp !== undefined ? { gexp } : {}),
      })
    );
  }
  async function put(cookie: string) {
    const app = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: `/api/guilds/${managedGuild}/config`,
      headers: { cookie, "content-type": "application/json" },
      payload: putBody,
    });
    await app.close();
    return res;
  }

  it("allows a write when the captured guild scope is still fresh", async () => {
    expect((await put(mgrCookie(Date.now() + 60_000))).statusCode).toBe(200);
  });

  it("blocks the write once the guild scope has aged out", async () => {
    const res = await put(mgrCookie(Date.now() - 1000));
    expect(res.statusCode).toBe(403);
    expect(res.json().detail).toMatch(/out of date/i);
  });

  it("blocks the write when the cookie predates the freshness field", async () => {
    expect((await put(mgrCookie())).statusCode).toBe(403);
  });

  it("does not require freshness for a sysadmin", async () => {
    expect((await put(adminCookie())).statusCode).toBe(200);
  });
});
