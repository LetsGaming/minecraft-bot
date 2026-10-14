/**
 * Characterization tests for the monitoring, servers and setup route modules,
 * driven through the real Fastify server: per-server capability scoping,
 * tenant isolation of the guild-setup reads, domain-guard ordering and the
 * failure mappings.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const OPERATOR = "444444444444444444"; // server:read + server:control on "*"
const READER = "555555555555555555"; // server:read on smp only
const AUDITOR = "777777777777777777"; // audit:read on "*"
const MANAGER = "888888888888888888"; // no grants, manages guild g1
const STRANGER = "666666666666666666";
const ROLLBACKER = "999999999999999999"; // server:rollback on smp only

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
      [READER]: { smp: ["server:read"] },
      [AUDITOR]: { "*": ["audit:read"] },
      [ROLLBACKER]: { smp: ["server:rollback"] },
    },
  },
};

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp", "creative"]),
}));

vi.mock("../../src/core/utils/config/configService.js", () => ({
  withConfigWriteLock: <T>(fn: () => Promise<T>) => fn(),
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

const instances = vi.hoisted(() => ({
  caps: null as null | { scripts: Record<string, boolean> },
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) =>
    ["smp", "creative"].includes(id)
      ? { config: { id }, capabilities: instances.caps }
      : null,
  ),
  getAllInstances: vi.fn(() => []),
}));

const access = vi.hoisted(() => ({
  runScript: vi.fn(),
  tailLog: vi.fn(),
  listStatsUuids: vi.fn(),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(),
  readUserCache: vi.fn(),
}));
vi.mock("../../src/core/utils/server/serverAccess.js", async () => ({
  ...access,
  // The real classifier: which failures count as "did not run" is the point.
  classifyScriptFailure: (await import("../../src/core/utils/server/access/scripts.js"))
    .classifyScriptFailure,
}));

const getUptimeStats = vi.fn();
vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  getUptimeStats: (id: string) => getUptimeStats(id) as unknown,
}));

const audit = vi.hoisted(() => ({
  loadAdminAudit: vi.fn(),
  recordAdminAction: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => audit);

vi.mock("../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));

const beat = vi.hoisted(() => ({ value: null as unknown, fresh: true }));
vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => beat.value),
  heartbeatIsFresh: vi.fn(() => beat.fresh),
}));

const playerCounts = vi.fn();
vi.mock("../../src/core/utils/stores/playerCountHistory.js", () => ({
  loadPlayerCountStore: () => playerCounts() as unknown,
}));

vi.mock("../../src/core/utils/commands/commandManifest.js", () => ({
  readCommandManifest: vi.fn(async () => ({ slash: [], ingame: [], updatedAt: 1 })),
}));

const discord = vi.hoisted(() => ({
  listBotGuilds: vi.fn(),
  listGuildChannels: vi.fn(),
  listGuildRoles: vi.fn(),
}));
vi.mock("../../src/web/backend/auth/discordRest.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/web/backend/auth/discordRest.js")>()),
  ...discord,
}));

import { encodeSigned, SESSION_COOKIE } from "../../src/web/backend/auth/auth.js";
import { buildServer } from "../../src/web/backend/server.js";
import { DiscordApiError } from "../../src/web/backend/auth/discordRest.js";
import { listIntents } from "../../src/core/utils/wrapper/deferredIntents.js";
import { clearLastKnown } from "../../src/core/utils/wrapper/lastKnown.js";
import { closeDbForTesting } from "../../src/core/db/index.js";

function cookieFor(uid: string, guilds: string[] = []): string {
  const session = {
    uid,
    tag: `user-${uid}`,
    guilds,
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  };
  return `${SESSION_COOKIE}=${encodeSigned(session)}`;
}

function call(
  method: "GET" | "POST" | "DELETE",
  url: string,
  uid = SYSADMIN,
  guilds: string[] = [],
) {
  return buildServer().inject({ method, url, headers: { cookie: cookieFor(uid, guilds) } });
}

beforeEach(() => {
  closeDbForTesting();
  clearLastKnown();
  vi.clearAllMocks();
  instances.caps = null;
  beat.value = { at: 1000, startedAt: 500, pid: 1, version: "9.9.9" };
  beat.fresh = true;
  getUptimeStats.mockReset().mockResolvedValue({ sparkline: "x" });
  audit.loadAdminAudit.mockReset().mockResolvedValue([]);
  audit.recordAdminAction.mockReset().mockResolvedValue(undefined);
  playerCounts.mockReset().mockResolvedValue({ version: 1, servers: {} });
  access.runScript.mockReset().mockResolvedValue({ exitCode: 0, output: "ok", stderr: "" });
  access.tailLog.mockReset().mockResolvedValue("a\n\nb\n");
  access.listStatsUuids.mockReset().mockResolvedValue([]);
  access.deleteStatsFile.mockReset().mockResolvedValue(true);
  access.readWhitelist.mockReset().mockResolvedValue([]);
  access.readUserCache.mockReset().mockResolvedValue([]);
  discord.listBotGuilds.mockReset().mockResolvedValue([]);
  discord.listGuildChannels.mockReset().mockResolvedValue([]);
  discord.listGuildRoles.mockReset().mockResolvedValue([]);
});

describe("monitoring routes", () => {
  it("/api/status reports the bot heartbeat and tolerates a missing one", async () => {
    let body = (await call("GET", "/api/status")).json();
    expect(body.bot).toEqual({ alive: true, lastBeat: 1000, startedAt: 500, version: "9.9.9" });

    beat.value = null;
    beat.fresh = false;
    body = (await call("GET", "/api/status")).json();
    expect(body.bot).toEqual({ alive: false, lastBeat: null, startedAt: null, version: null });
  });

  it("/api/status lists every server for a wildcard operator", async () => {
    const res = await call("GET", "/api/status", OPERATOR);
    expect(res.statusCode).toBe(200);
    expect(res.json().servers.map((s: { id: string }) => s.id)).toEqual(["smp", "creative"]);
  });

  it("/api/uptime is scoped per server and 404s unknown ids after the gate", async () => {
    expect((await call("GET", "/api/uptime/smp", READER)).statusCode).toBe(200);
    expect((await call("GET", "/api/uptime/creative", READER)).statusCode).toBe(403);
    expect((await call("GET", "/api/uptime/nope", READER)).statusCode).toBe(403);
    expect((await call("GET", "/api/uptime/nope")).statusCode).toBe(404);
    expect(getUptimeStats).toHaveBeenCalledTimes(1);
    expect(getUptimeStats).toHaveBeenCalledWith("smp");
  });

  it("/api/activity returns the stored series, or an empty one", async () => {
    playerCounts.mockResolvedValue({ version: 1, servers: { smp: [{ h: 1, sum: 2, max: 3, samples: 4 }] } });
    expect((await call("GET", "/api/activity/smp", READER)).json()).toEqual({
      serverId: "smp",
      series: [{ h: 1, sum: 2, max: 3, samples: 4 }],
    });
    expect((await call("GET", "/api/activity/creative")).json().series).toEqual([]);
    expect((await call("GET", "/api/activity/creative", READER)).statusCode).toBe(403);
    expect((await call("GET", "/api/activity/nope")).statusCode).toBe(404);
  });

  it("/api/audit returns the newest entries first and clamps the limit", async () => {
    const entries = Array.from({ length: 600 }, (_, n) => ({ at: String(n), action: "a" }));
    audit.loadAdminAudit.mockResolvedValue(entries);

    let body = (await call("GET", "/api/audit")).json();
    expect(body.entries).toHaveLength(100);
    expect(body.entries[0].at).toBe("599");

    body = (await call("GET", "/api/audit?limit=2")).json();
    expect(body.entries.map((e: { at: string }) => e.at)).toEqual(["599", "598"]);

    expect((await call("GET", "/api/audit?limit=99999")).json().entries).toHaveLength(500);
    expect((await call("GET", "/api/audit?limit=0")).json().entries).toHaveLength(100);
    expect((await call("GET", "/api/audit?limit=-5")).json().entries).toHaveLength(1);
  });

  it("/api/audit needs a fleet-wide audit grant", async () => {
    expect((await call("GET", "/api/audit", AUDITOR)).statusCode).toBe(200);
    expect((await call("GET", "/api/audit", READER)).statusCode).toBe(403);
    expect((await call("GET", "/api/audit", OPERATOR)).statusCode).toBe(403);
  });
});

describe("server action routes", () => {
  it("checks existence, then action validity, then the wrapper capability", async () => {
    expect((await call("POST", "/api/servers/nope/restart")).statusCode).toBe(404);
    expect((await call("POST", "/api/servers/nope/explode")).statusCode).toBe(404);
    expect((await call("POST", "/api/servers/smp/explode")).statusCode).toBe(400);

    instances.caps = { scripts: { restart: false } };
    expect((await call("POST", "/api/servers/smp/restart")).statusCode).toBe(409);
    expect(access.runScript).not.toHaveBeenCalled();
    expect(audit.recordAdminAction).not.toHaveBeenCalled();
  });

  it("runs the script, audits it and truncates output to the last 4000 characters", async () => {
    access.runScript.mockResolvedValue({
      exitCode: 0,
      output: "x".repeat(5000) + "END",
      stderr: "err",
    });
    const res = await call("POST", "/api/servers/smp/restart", OPERATOR);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ ok: true, exitCode: 0, stderr: "err" });
    expect(body.output).toHaveLength(4000);
    expect(body.output.endsWith("END")).toBe(true);
    expect(audit.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "restart (dashboard)",
        server: "smp",
        byId: OPERATOR,
      }),
    );
  });

  it("reports a non-zero exit as ok:false without remembering an intent", async () => {
    access.runScript.mockResolvedValue({ exitCode: 3, output: "", stderr: "boom" });
    const body = (await call("POST", "/api/servers/smp/backup")).json();
    expect(body).toMatchObject({ ok: false, exitCode: 3 });
    expect(listIntents("smp")).toEqual([]);
  });

  it("answers 503 and remembers the intent when the wrapper is unreachable, then clears it on success", async () => {
    access.runScript.mockRejectedValueOnce(new Error("ECONNREFUSED /secret/path"));
    const res = await call("POST", "/api/servers/smp/restart");
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("/secret/path");
    expect(listIntents("smp")).toMatchObject([{ action: "restart", serverId: "smp" }]);

    expect((await call("GET", "/api/servers/smp/pending-actions", READER)).json().intents).toHaveLength(1);

    await call("POST", "/api/servers/smp/restart");
    expect(listIntents("smp")).toEqual([]);
  });

  it("reports a script still running instead of offering a retry (AUD-012)", async () => {
    const { ScriptStillRunningError } = await import("../../src/core/utils/server/access/scripts.js");
    access.runScript.mockRejectedValueOnce(new ScriptStillRunningError("backup", 600_000));
    const res = await call("POST", "/api/servers/smp/backup");
    expect(res.statusCode).toBe(504);
    expect(res.json().error).toContain("still running");
    expect(listIntents("smp")).toEqual([]);
  });

  it("passes a wrapper refusal through instead of offering a retry (AUD-012)", async () => {
    const { ApiError } = await import("../../src/core/utils/server/access/apiClient.js");
    access.runScript.mockRejectedValueOnce(
      new ApiError("/scripts/run", 409, JSON.stringify({ error: "Another operation is running (backup)" })),
    );
    const res = await call("POST", "/api/servers/smp/restart");
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain("Another operation is running");
    expect(listIntents("smp")).toEqual([]);
  });

  it("only operators may trigger actions or dismiss pending ones", async () => {
    expect((await call("POST", "/api/servers/smp/restart", READER)).statusCode).toBe(403);
    expect((await call("DELETE", "/api/servers/smp/pending-actions/restart", READER)).statusCode).toBe(403);
    expect((await call("DELETE", "/api/servers/smp/pending-actions/restart", OPERATOR)).statusCode).toBe(200);
    expect((await call("GET", "/api/servers/creative/pending-actions", READER)).statusCode).toBe(403);
    expect((await call("POST", "/api/servers/smp/restart", STRANGER)).statusCode).toBe(403);
  });

  it("requires server:rollback, not server:control, for a rollback (AUD-003)", async () => {
    access.runScript.mockResolvedValue({ exitCode: 0, output: "", stderr: "" });
    expect((await call("POST", "/api/servers/smp/rollback", OPERATOR)).statusCode).toBe(403);
    expect(access.runScript).not.toHaveBeenCalled();

    const res = await call("POST", "/api/servers/smp/rollback", ROLLBACKER);
    expect(res.statusCode).toBe(200);
    expect(access.runScript).toHaveBeenCalledWith({ id: "smp" }, "rollback");
    // The grant is per server, and buys no other action.
    expect((await call("POST", "/api/servers/creative/rollback", ROLLBACKER)).statusCode).toBe(403);
    expect((await call("POST", "/api/servers/smp/restart", ROLLBACKER)).statusCode).toBe(403);
  });
});

describe("log route", () => {
  it("splits the tail into non-empty lines, clamps the line count and reports no staleness on success", async () => {
    const res = await call("GET", "/api/servers/smp/log?lines=9999", READER);
    expect(res.json()).toEqual({ lines: ["a", "b"], stale: null });
    expect(access.tailLog).toHaveBeenCalledWith({ id: "smp" }, 500);

    await call("GET", "/api/servers/smp/log?lines=0");
    expect(access.tailLog).toHaveBeenLastCalledWith({ id: "smp" }, 50);
    await call("GET", "/api/servers/smp/log");
    expect(access.tailLog).toHaveBeenLastCalledWith({ id: "smp" }, 50);
  });

  it("serves the last known tail, marked stale, when the wrapper stops answering", async () => {
    await call("GET", "/api/servers/smp/log");
    access.tailLog.mockRejectedValue(new Error("wrapper down"));
    const res = await call("GET", "/api/servers/smp/log");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      lines: ["a", "b"],
      stale: { reason: "wrapper down" },
    });
  });

  it("returns a fixed 500 message when there is nothing to fall back to", async () => {
    access.tailLog.mockRejectedValue(new Error("secret /srv/path"));
    const res = await call("GET", "/api/servers/smp/log");
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("/srv/path");
  });
});

describe("prune-stats route", () => {
  beforeEach(() => {
    access.listStatsUuids.mockResolvedValue(["AAA", "bbb", "ccc"]);
    access.readWhitelist.mockResolvedValue([{ uuid: "aaa" }]);
    access.readUserCache.mockResolvedValue([{ uuid: "BBB" }, {}]);
  });

  it("lists prunable UUIDs on a dry run without deleting or auditing", async () => {
    for (const flag of ["1", "true"]) {
      const body = (await call("POST", `/api/servers/smp/prune-stats?dryRun=${flag}`)).json();
      expect(body).toEqual({ dryRun: true, prunable: ["ccc"] });
    }
    expect(access.deleteStatsFile).not.toHaveBeenCalled();
    expect(audit.recordAdminAction).not.toHaveBeenCalled();
  });

  it("deletes unknown UUIDs, counts only successes and audits the result", async () => {
    access.listStatsUuids.mockResolvedValue(["AAA", "ccc", "ddd"]);
    access.deleteStatsFile.mockImplementation(async (_s: unknown, u: string) => u === "ccc");
    const body = (await call("POST", "/api/servers/smp/prune-stats", OPERATOR)).json();
    expect(body).toEqual({ dryRun: false, deleted: 1, prunable: ["ccc", "ddd"] });
    expect(audit.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "prune-stats (dashboard)", detail: "1 stats file(s) deleted" }),
    );
  });

  it("refuses to prune when the whitelist can't be read (AUD-004)", async () => {
    access.readWhitelist.mockRejectedValue(new Error("secret /srv/path"));
    access.readUserCache.mockRejectedValue(new Error("x"));
    const res = await call("POST", "/api/servers/smp/prune-stats");
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain("/srv/path");
    expect(access.deleteStatsFile).not.toHaveBeenCalled();
  });

  it("refuses to prune when the whitelist and usercache are both empty", async () => {
    access.readWhitelist.mockResolvedValue([]);
    access.readUserCache.mockResolvedValue([]);
    const res = await call("POST", "/api/servers/smp/prune-stats");
    expect(res.statusCode).toBe(409);
    expect(access.deleteStatsFile).not.toHaveBeenCalled();
  });

  it("is gated by server:control on the target server", async () => {
    expect((await call("POST", "/api/servers/smp/prune-stats", READER)).statusCode).toBe(403);
    expect((await call("POST", "/api/servers/nope/prune-stats")).statusCode).toBe(404);
  });
});

describe("setup routes", () => {
  const guilds = [
    { id: "g1", name: "One", icon: null, manageable: true },
    { id: "g2", name: "Two", icon: null, manageable: true },
  ];

  it("requires a login", async () => {
    expect((await buildServer().inject({ method: "GET", url: "/api/setup/guilds" })).statusCode).toBe(401);
  });

  it("lists every guild for a sysadmin but only managed ones for everyone else", async () => {
    discord.listBotGuilds.mockResolvedValue(guilds);
    expect((await call("GET", "/api/setup/guilds")).json().guilds).toHaveLength(2);
    expect((await call("GET", "/api/setup/guilds", MANAGER, ["g1"])).json().guilds).toEqual([guilds[0]]);
    expect((await call("GET", "/api/setup/guilds", STRANGER)).json().guilds).toEqual([]);
  });

  it("only exposes channels and roles of guilds the caller manages", async () => {
    discord.listGuildChannels.mockResolvedValue([{ id: "c", name: "general", type: 0 }]);
    discord.listGuildRoles.mockResolvedValue([{ id: "r", name: "mods" }]);

    expect((await call("GET", "/api/setup/guilds/g1/channels", MANAGER, ["g1"])).json().channels).toHaveLength(1);
    expect((await call("GET", "/api/setup/guilds/g1/roles", MANAGER, ["g1"])).json().roles).toHaveLength(1);
    expect((await call("GET", "/api/setup/guilds/g2/channels", MANAGER, ["g1"])).statusCode).toBe(403);
    expect((await call("GET", "/api/setup/guilds/g2/roles", MANAGER, ["g1"])).statusCode).toBe(403);
    expect(discord.listGuildChannels).toHaveBeenCalledTimes(1);
    expect(discord.listGuildRoles).toHaveBeenCalledTimes(1);

    expect((await call("GET", "/api/setup/guilds/g2/channels")).statusCode).toBe(200);
  });

  it("maps Discord failures to typed HTTP errors", async () => {
    const cases: Array<[unknown, number, string]> = [
      [new DiscordApiError("no token", "no-token"), 503, "DISCORD_TOKEN_MISSING"],
      [new DiscordApiError("slow down", "rate-limit", null, 4), 429, "RATE_LIMITED"],
      [new DiscordApiError("bad token", "http", 401), 502, "DISCORD_TOKEN_REJECTED"],
      [new DiscordApiError("missing access", "http", 403), 403, "FORBIDDEN"],
      [new DiscordApiError("unknown guild", "http", 404), 404, "NOT_FOUND"],
      [new DiscordApiError("oops", "http", 500), 502, "BAD_GATEWAY"],
      [new Error("socket hang up"), 502, "BAD_GATEWAY"],
    ];
    for (const [err, status, code] of cases) {
      discord.listBotGuilds.mockRejectedValueOnce(err);
      const res = await call("GET", "/api/setup/guilds");
      expect(res.statusCode).toBe(status);
      expect(res.json().code).toBe(code);
    }
  });

  it("lists server names filtered to the caller's read access, with a 403 for no host access", async () => {
    expect((await call("GET", "/api/setup/servers")).json().servers).toEqual(["smp", "creative"]);
    expect((await call("GET", "/api/setup/servers", READER)).json().servers).toEqual(["smp"]);
    expect((await call("GET", "/api/setup/servers", OPERATOR)).json().servers).toEqual(["smp", "creative"]);
    expect((await call("GET", "/api/setup/servers", MANAGER, ["g1"])).statusCode).toBe(403);
  });
});
