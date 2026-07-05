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

vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp"]),
}));

vi.mock("../src/common/utils/configService.js", () => ({
  readRawConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  validateCandidate: vi.fn(() => ({ valid: true, errors: [], warnings: ["w1"] })),
  writeConfig: vi.fn(async () => {}),
}));

vi.mock("../src/common/utils/server.js", () => ({
  getServerInstance: vi.fn(() => null),
  getAllInstances: vi.fn(() => []),
}));

vi.mock("../src/common/utils/serverAccess.js", () => ({
  runScript: vi.fn(),
  tailLog: vi.fn(),
  listStatsUuids: vi.fn(),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(),
  readUserCache: vi.fn(),
}));

vi.mock("../src/common/utils/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(async () => ({ sparkline: "" })),
}));

vi.mock("../src/common/utils/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => [
    { at: "2026-01-01", action: "kick", server: "smp", by: "a", byId: "1", guildId: null },
  ]),
  recordAdminAction: vi.fn(async () => {}),
}));

vi.mock("../src/common/utils/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));

vi.mock("../src/common/utils/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => ({
    at: Date.now(),
    startedAt: Date.now() - 1000,
    pid: 1,
    version: "test",
  })),
  heartbeatIsFresh: vi.fn(() => true),
}));

vi.mock("../src/common/utils/playerCountHistory.js", () => ({
  loadPlayerCountStore: vi.fn(async () => ({ version: 1, servers: {} })),
}));

import {
  encodeSigned,
  decodeSigned,
  webAdminIds,
  SESSION_COOKIE,
} from "../src/web/backend/auth.js";
import {
  toSafeConfig,
  mergeSecretPlaceholders,
  SECRET_PLACEHOLDER,
} from "../src/web/backend/safeConfig.js";
import { buildServer } from "../src/web/backend/server.js";
import type { RawBotConfig } from "../src/common/types/index.js";

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

describe("webAdminIds", () => {
  it("collects user-ID entries globally and per guild, skipping role names", () => {
    const ids = webAdminIds();
    expect(ids.has("111111111111111111")).toBe(true);
    expect(ids.has("333333333333333333")).toBe(true);
    expect(ids.has("admin-role-name")).toBe(false);
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

  it("rejects sessions of users no longer in adminUsers", async () => {
    const app = buildServer();
    const stranger = encodeSigned({
      uid: "999999999999999999",
      tag: "x",
      exp: Date.now() + 60_000,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { cookie: `${SESSION_COOKIE}=${stranger}` },
    });
    expect(res.statusCode).toBe(401);
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
    expect(config.json().token).toBe(SECRET_PLACEHOLDER);
    await app.close();
  });

  it("PUT /api/config merges placeholders and writes on valid input", async () => {
    const { writeConfig, validateCandidate } = await import(
      "../src/common/utils/configService.js"
    );
    const app = buildServer();
    const submitted = toSafeConfig(mockConfig as unknown as RawBotConfig);

    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { cookie: adminCookie(), "content-type": "application/json" },
      payload: submitted,
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
      "../src/common/utils/configService.js"
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
      payload: {},
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toEqual(["  - bad thing"]);
    expect(vi.mocked(writeConfig)).not.toHaveBeenCalled();
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
