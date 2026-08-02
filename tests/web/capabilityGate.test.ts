/**
 * RBAC-02/03 — the host-side authorization gate, end to end through Fastify.
 *
 * Two things are being proved here, and the second matters more than the first:
 *
 *   1. The gate grants and denies the right things (per-server vs fleet-wide,
 *      sysadmin short-circuit, the strict lookup for global routes).
 *   2. A host route that forgets to declare a capability CANNOT boot. Moving
 *      authorization from the scope to the route trades one guaranteed gate
 *      for N declared ones, and the boot assertion is what pays that back.
 *
 * The pure resolution logic is covered separately in capabilities.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const OPERATOR = "444444444444444444"; // server:read + server:control on "*"
const EDITOR = "555555555555555555"; // config:* on smp only
const STRANGER = "666666666666666666"; // logged in, granted nothing

const mockConfig = {
  token: "real-bot-token",
  clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { smp: { apiKey: "k-1" }, creative: { apiKey: "k-2" } },
  guilds: {},
  webui: {
    enabled: true,
    port: 8130,
    grants: {
      [OPERATOR]: { "*": ["server:read", "server:control"] },
      [EDITOR]: { smp: ["config:read", "config:write", "server:read"] },
    },
  },
};

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp", "creative"]),
}));

vi.mock("../../src/core/utils/config/configService.js", () => ({
  readRawConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  validateCandidate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
  writeConfig: vi.fn(async () => ({ warnings: [], changed: true })),
  configFileHash: vi.fn(() => "hash-1"),
}));

vi.mock("../../src/core/utils/config/configHistory.js", () => ({
  RETENTION_DAYS: 3,
  snapshotConfig: vi.fn(),
  listConfigHistory: vi.fn(() => []),
  getConfigSnapshot: vi.fn(() => null),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  // The gate runs before the domain guard, so these tests need real instances
  // to tell "denied" (403) apart from "no such server" (404). capabilities is
  // null = an older wrapper that advertises nothing, which servers.ts treats
  // as "assume every script is available".
  getServerInstance: vi.fn((id: string) =>
    ["smp", "creative"].includes(id) ? { config: { id }, capabilities: null } : null,
  ),
  getAllInstances: vi.fn(() => []),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  runScript: vi.fn(async () => ({ exitCode: 0, output: "", stderr: "" })),
  tailLog: vi.fn(async () => "line"),
  listStatsUuids: vi.fn(async () => []),
  deleteStatsFile: vi.fn(async () => true),
  readWhitelist: vi.fn(async () => []),
  readUserCache: vi.fn(async () => []),
}));

vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(async () => ({ sparkline: "" })),
}));

vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => []),
  recordAdminAction: vi.fn(async () => {}),
}));

vi.mock("../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));

vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => ({
    at: Date.now(),
    startedAt: Date.now() - 1000,
    pid: 1,
    version: "test",
  })),
  heartbeatIsFresh: vi.fn(() => true),
}));

vi.mock("../../src/core/utils/stores/playerCountHistory.js", () => ({
  loadPlayerCountStore: vi.fn(async () => ({ version: 1, servers: {} })),
}));

vi.mock("../../src/core/utils/commands/commandManifest.js", () => ({
  readCommandManifest: vi.fn(async () => ({ slash: [], ingame: [], updatedAt: 1 })),
}));

import Fastify from "fastify";
import { encodeSigned, SESSION_COOKIE } from "../../src/web/backend/auth/auth.js";
import {
  assertCapabilitiesDeclared,
  capabilityGate,
  visibleServerIds,
  capabilityMap,
} from "../../src/web/backend/auth/capabilities.js";
import { buildServer } from "../../src/web/backend/server.js";
import type { Session } from "../../src/web/backend/auth/auth.js";

function cookieFor(uid: string): string {
  const session = {
    uid,
    tag: `user-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  };
  return `${SESSION_COOKIE}=${encodeSigned(session)}`;
}

function sessionFor(uid: string): Session {
  return {
    uid,
    tag: `user-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── RBAC-03: the boot assertion ─────────────────────────────────────────────

describe("assertCapabilitiesDeclared", () => {
  /** Build a throwaway scope with one route, the way server.ts does. */
  async function register(
    url: string,
    options: Record<string, unknown>,
  ): Promise<void> {
    const app = Fastify({ logger: false });
    await app.register(async (api) => {
      assertCapabilitiesDeclared(api);
      api.get(url, options, async () => ({ ok: true }));
    });
    await app.ready();
  }

  it("accepts a fully declared server-scoped route", async () => {
    await expect(
      register("/api/servers/:id/log", {
        config: { capability: "server:read", scope: "server", param: "id" },
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses to boot a route with no capability", async () => {
    // The whole point of the assertion: this is the mistake that would
    // otherwise ship as an open host route.
    await expect(register("/api/servers/:id/log", {})).rejects.toThrow(
      /declares no capability/,
    );
  });

  it("refuses an unknown capability", async () => {
    await expect(
      register("/api/x", { config: { capability: "server:delete", scope: "global" } }),
    ).rejects.toThrow(/unknown capability/);
  });

  it("refuses a capability with no scope", async () => {
    await expect(
      register("/api/x", { config: { capability: "server:read" } }),
    ).rejects.toThrow(/no\s+scope/);
  });

  it("refuses a server scope with no param", async () => {
    await expect(
      register("/api/servers/:id/log", {
        config: { capability: "server:read", scope: "server" },
      }),
    ).rejects.toThrow(/names no param/);
  });

  it("refuses a server scope whose param is not in the path", async () => {
    // Would deny every request at runtime, silently. Caught at boot instead.
    await expect(
      register("/api/servers/:id/log", {
        config: { capability: "server:read", scope: "server", param: "serverId" },
      }),
    ).rejects.toThrow(/not in its path/);
  });

  it("passes for the real server, proving every host route declares one", async () => {
    // The regression test that matters: adding a host route without a rule
    // fails here rather than in review.
    expect(() => buildServer()).not.toThrow();
    await buildServer().ready();
  });
});

// ── RBAC-02: the gate ───────────────────────────────────────────────────────

describe("the capability gate", () => {
  it("401s without a session, on every host route", async () => {
    const app = buildServer();
    for (const url of ["/api/status", "/api/audit", "/api/config", "/api/servers/smp/log"]) {
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    }
  });

  it("lets a sysadmin through everywhere", async () => {
    const app = buildServer();
    const cookie = cookieFor(SYSADMIN);
    for (const url of ["/api/status", "/api/audit", "/api/config", "/api/servers/smp/log"]) {
      expect(
        (await app.inject({ method: "GET", url, headers: { cookie } })).statusCode,
      ).toBe(200);
    }
  });

  it("403s a logged-in user with no grants", async () => {
    const app = buildServer();
    const cookie = cookieFor(STRANGER);
    for (const url of ["/api/status", "/api/audit", "/api/config"]) {
      expect(
        (await app.inject({ method: "GET", url, headers: { cookie } })).statusCode,
      ).toBe(403);
    }
  });

  it("grants a wildcard operator on any server", async () => {
    const app = buildServer();
    const cookie = cookieFor(OPERATOR);
    for (const id of ["smp", "creative"]) {
      expect(
        (await app.inject({ method: "GET", url: `/api/servers/${id}/log`, headers: { cookie } }))
          .statusCode,
      ).toBe(200);
    }
  });

  it("scopes a per-server grantee to their own server", async () => {
    const app = buildServer();
    const cookie = cookieFor(EDITOR);
    expect(
      (await app.inject({ method: "GET", url: "/api/servers/smp/log", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await app.inject({ method: "GET", url: "/api/servers/creative/log", headers: { cookie } }))
        .statusCode,
    ).toBe(403);
  });

  it("denies an operation the grantee does not hold", async () => {
    // The editor may read smp's log but must not restart it.
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: "/api/servers/smp/restart",
      headers: { cookie: cookieFor(EDITOR) },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not let a per-server grant satisfy a fleet-wide route", async () => {
    // SECURITY: the audit log spans every server. A grant on smp must not
    // disclose what happened on creative.
    const app = buildServer();
    expect(
      (await app.inject({ method: "GET", url: "/api/audit", headers: { cookie: cookieFor(EDITOR) } }))
        .statusCode,
    ).toBe(403);
  });

  it("never grants bot:config to a non-sysadmin", async () => {
    const app = buildServer();
    for (const uid of [OPERATOR, EDITOR, STRANGER]) {
      expect(
        (await app.inject({ method: "GET", url: "/api/config", headers: { cookie: cookieFor(uid) } }))
          .statusCode,
      ).toBe(403);
    }
  });

  it("denies before the body schema runs", async () => {
    // The ordering the sysadmin gate always had, preserved: an unauthorized
    // caller gets 403, never a 400 that would confirm the body's shape.
    const app = buildServer();
    const res = await app.inject({
      method: "PUT",
      url: "/api/config",
      headers: { cookie: cookieFor(EDITOR), "content-type": "application/json" },
      payload: { nonsense: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it("404s an unknown server rather than leaking it through the gate", async () => {
    // A sysadmin passes the gate, so the domain guard decides — and it should
    // still be the one saying the server does not exist.
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/uptime/nope",
      headers: { cookie: cookieFor(SYSADMIN) },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ── Collection filtering ────────────────────────────────────────────────────

describe("/api/status filtering", () => {
  it("returns every server to a sysadmin", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { cookie: cookieFor(SYSADMIN) },
    });
    expect(res.json().servers).toHaveLength(2);
  });

  it("returns only the granted server to a per-server grantee", async () => {
    // The rule the letsgaming-de work settled on, applied here: the client
    // receives only what it may display, enforced server-side.
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/status",
      headers: { cookie: cookieFor(EDITOR) },
    });
    const ids = res.json().servers.map((s: { id: string }) => s.id);
    expect(ids).toEqual(["smp"]);
  });
});

describe("visibleServerIds", () => {
  const ids = ["smp", "creative"];

  it("gives a sysadmin everything", () => {
    expect(visibleServerIds(sessionFor(SYSADMIN), ids)).toEqual(ids);
  });

  it("filters to the granted server", () => {
    expect(visibleServerIds(sessionFor(EDITOR), ids)).toEqual(["smp"]);
  });

  it("is empty for a stranger", () => {
    expect(visibleServerIds(sessionFor(STRANGER), ids)).toEqual([]);
  });
});

// ── DSH-05: what the frontend renders from ──────────────────────────────────

describe("capabilityMap", () => {
  const ids = ["smp", "creative"];

  it("gives a sysadmin every capability on every server", () => {
    const map = capabilityMap(sessionFor(SYSADMIN), ids);
    expect(map.smp).toContain("backup:restore");
    expect(map.creative).toContain("backup:restore");
    expect(map["*"]).toContain("server:rollback");
  });

  it("reports a wildcard grant under both the servers and '*'", () => {
    const map = capabilityMap(sessionFor(OPERATOR), ids);
    expect(map["*"]).toEqual(
      expect.arrayContaining(["server:read", "server:control"]),
    );
    expect(map.smp).toEqual(expect.arrayContaining(["server:control"]));
  });

  it("omits servers the user holds nothing on", () => {
    const map = capabilityMap(sessionFor(EDITOR), ids);
    expect(Object.keys(map)).toEqual(["smp"]);
    expect(map.smp).toEqual(
      expect.arrayContaining(["config:read", "config:write", "server:read"]),
    );
  });

  it("is empty for a stranger, so the UI can show one clear empty state", () => {
    expect(capabilityMap(sessionFor(STRANGER), ids)).toEqual({});
  });
});

describe("/api/me", () => {
  it("carries the capability map", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { cookie: cookieFor(EDITOR) },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sysadmin).toBe(false);
    expect(body.capabilities.smp).toContain("config:write");
    expect(body.capabilities.creative).toBeUndefined();
  });
});
