/**
 * The Mods tab's "check another Minecraft version" routes: capability and
 * server scope, the wrapper-absent degrade, and that nothing the wrapper
 * says reaches the client or a log line unescaped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const MODS_READER = "777777777777777777";
const PLAIN_READER = "888888888888888888"; // server:read only
const OTHER_SERVER_READER = "999999999999999990"; // mods:read on another server

const G1A = "100000000000000001";
const G1B = "100000000000000002";
const G1C = "100000000000000003";
const G2A = "200000000000000001";

const mockConfig = {
  token: "t",
  clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { smp: { id: "smp", apiKey: "k-1" }, other: { id: "other", apiKey: "k-2" } },
  guilds: {},
  webui: {
    enabled: true,
    grants: {
      [MODS_READER]: { smp: ["server:read", "mods:read"] },
      [PLAIN_READER]: { smp: ["server:read"] },
      [OTHER_SERVER_READER]: { other: ["server:read", "mods:read"] },
      [G1A]: { smp: ["server:read", "mods:read"], other: ["server:read", "mods:read"] },
      [G1B]: { smp: ["server:read", "mods:read"], other: ["server:read", "mods:read"] },
      [G1C]: { smp: ["server:read", "mods:read"] },
      [G2A]: { smp: ["server:read", "mods:read"] },
    },
  },
};

const {
  supportsModCompatMock,
  startModCompatMock,
  getModCompatMock,
  listInstalledModsMock,
  fetchReleaseVersionsMock,
  logErrorMock,
} = vi.hoisted(() => ({
  supportsModCompatMock: vi.fn(),
  startModCompatMock: vi.fn(),
  getModCompatMock: vi.fn(),
  listInstalledModsMock: vi.fn(),
  fetchReleaseVersionsMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp", "other"]),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: logErrorMock, debug: vi.fn() },
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  supportsModCompat: supportsModCompatMock,
  startModCompat: startModCompatMock,
  getModCompat: getModCompatMock,
  listInstalledMods: listInstalledModsMock,
  detectCapabilities: vi.fn(async () => ({
    scripts: {},
    backups: true,
    restore: true,
    modManifest: true,
    variablesFile: true,
  })),
  getRemoteManifest: vi.fn(async () => null),
  sendCommand: vi.fn(),
  openLogStream: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  runScript: vi.fn(),
  tailLog: vi.fn(async () => ""),
  listStatsUuids: vi.fn(async () => []),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(async () => []),
  readUserCache: vi.fn(async () => []),
}));

vi.mock("../../src/core/utils/minecraft/mojang.js", () => ({
  fetchReleaseVersions: fetchReleaseVersionsMock,
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getServerInstance: vi.fn((id: string) =>
    id === "smp" || id === "other"
      ? {
          id,
          config: { id, apiKey: "k" },
          capabilities: null,
          getHealth: async () => ({
            state: "online",
            rcon: "responsive",
            wrapper: "up",
            source: "wrapper",
            players: { online: 0, max: 20, names: [], sampled: false },
          }),
          getList: async () => ({ playerCount: 0, maxPlayers: 20, players: [] }),
          getTps: async () => null,
        }
      : null,
  ),
  getAllInstances: vi.fn(() => []),
}));

vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => []),
  recordAdminAction: vi.fn(async () => {}),
}));
vi.mock("../../src/core/utils/config/configService.js", () => ({
  readRawConfig: vi.fn(() => JSON.parse(JSON.stringify(mockConfig))),
  validateCandidate: vi.fn(() => ({ valid: true, errors: [], warnings: [] })),
  writeConfig: vi.fn(async () => ({ warnings: [], changed: true })),
  configFileHash: vi.fn(() => "h"),
}));
vi.mock("../../src/core/utils/config/configHistory.js", () => ({
  RETENTION_DAYS: 3,
  snapshotConfig: vi.fn(),
  listConfigHistory: vi.fn(() => []),
  getConfigSnapshot: vi.fn(() => null),
}));
vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({
  getUptimeStats: vi.fn(async () => ({})),
}));
vi.mock("../../src/core/utils/server/hostResources.js", () => ({
  getHostResources: vi.fn(async () => null),
}));
vi.mock("../../src/core/utils/server/runtimeHeartbeat.js", () => ({
  readRuntimeHeartbeat: vi.fn(async () => null),
  heartbeatIsFresh: vi.fn(() => false),
}));
vi.mock("../../src/core/utils/stores/playerCountHistory.js", () => ({
  loadPlayerCountStore: vi.fn(async () => ({ version: 1, servers: {} })),
}));
vi.mock("../../src/core/utils/commands/commandManifest.js", () => ({
  readCommandManifest: vi.fn(async () => ({ slash: [], ingame: [], updatedAt: 1 })),
}));

import { encodeSigned, SESSION_COOKIE } from "../../src/web/backend/auth/auth.js";
import { buildServer } from "../../src/web/backend/server.js";
import { invalidateWhere } from "../../src/core/utils/cache.js";

const JOB = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";

function cookieFor(uid: string, guilds: string[] = []): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds,
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}

const post = (uid: string, payload: unknown, server = "smp") => ({
  method: "POST" as const,
  url: `/api/servers/${server}/mods/compat`,
  headers: { cookie: cookieFor(uid), "content-type": "application/json" },
  payload: payload as object,
});
const get = (uid: string, path: string, server = "smp") => ({
  method: "GET" as const,
  url: `/api/servers/${server}/mods/compat${path}`,
  headers: { cookie: cookieFor(uid) },
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhere(() => true);
  supportsModCompatMock.mockResolvedValue(true);
  startModCompatMock.mockResolvedValue({ jobId: JOB });
  getModCompatMock.mockResolvedValue({
    jobId: JOB,
    state: "running",
    mcVersion: "1.21.5",
    modLoader: "fabric",
    progress: { done: 1, total: 3 },
    partial: [],
  });
  listInstalledModsMock.mockResolvedValue({
    gameVersion: "1.21.4",
    modLoader: "fabric",
    mtimeMs: 1,
    mods: [],
  });
  fetchReleaseVersionsMock.mockResolvedValue(["1.21.5", "1.21.4"]);
});

describe("capability and server scope", () => {
  it("needs mods:read; server:read alone is refused", async () => {
    const app = buildServer();
    const res = await app.inject(post(PLAIN_READER, { mcVersion: "1.21.5" }));
    expect(res.statusCode).toBe(403);
    expect(startModCompatMock).not.toHaveBeenCalled();
    expect((await app.inject(get(PLAIN_READER, `/${JOB}`))).statusCode).toBe(403);
    expect((await app.inject(get(PLAIN_READER, "/versions"))).statusCode).toBe(403);
    expect(getModCompatMock).not.toHaveBeenCalled();
  });

  it("a mods:read grant on another server does not reach this one", async () => {
    const app = buildServer();
    expect((await app.inject(post(OTHER_SERVER_READER, { mcVersion: "1.21.5" }))).statusCode).toBe(403);
    expect((await app.inject(get(OTHER_SERVER_READER, `/${JOB}`))).statusCode).toBe(403);
    expect(startModCompatMock).not.toHaveBeenCalled();
    expect(getModCompatMock).not.toHaveBeenCalled();
  });

  it("a reader starts and polls on their own server", async () => {
    const app = buildServer();
    const started = await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    expect(started.statusCode).toBe(200);
    expect(started.json()).toEqual({ jobId: JOB });
    expect(startModCompatMock).toHaveBeenCalledWith(expect.anything(), "1.21.5", false);

    const polled = await app.inject(get(MODS_READER, `/${JOB}`));
    expect(polled.statusCode).toBe(200);
    expect(polled.json().progress).toEqual({ done: 1, total: 3 });
  });

  it("passes refresh through", async () => {
    const app = buildServer();
    await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }));
    expect(startModCompatMock).toHaveBeenCalledWith(expect.anything(), "1.21.5", true);
  });
});

describe("input validation", () => {
  it.each([{}, { mcVersion: "1 2" }, { mcVersion: "../x" }, { mcVersion: "a".repeat(21) }])(
    "400s on %j before contacting the wrapper",
    async (body) => {
      const app = buildServer();
      const res = await app.inject(post(MODS_READER, body));
      expect(res.statusCode).toBe(400);
      expect(startModCompatMock).not.toHaveBeenCalled();
    },
  );

  it("400s a job id that is not a uuid", async () => {
    const app = buildServer();
    const res = await app.inject(get(MODS_READER, "/not-a-job"));
    expect(res.statusCode).toBe(400);
    expect(getModCompatMock).not.toHaveBeenCalled();
  });
});

describe("wrapper without mod-compat", () => {
  it("answers 501, never calls the job routes, and reports compat=false on the list", async () => {
    supportsModCompatMock.mockResolvedValue(false);
    const app = buildServer();
    const res = await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    expect(res.statusCode).toBe(501);
    expect(startModCompatMock).not.toHaveBeenCalled();

    const installed = await app.inject({
      method: "GET",
      url: "/api/servers/smp/mods/installed",
      headers: { cookie: cookieFor(MODS_READER) },
    });
    expect(installed.statusCode).toBe(200);
    expect(installed.json().compat).toBe(false);
  });

  it("reports compat=true when the wrapper has the feature", async () => {
    const app = buildServer();
    const installed = await app.inject({
      method: "GET",
      url: "/api/servers/smp/mods/installed",
      headers: { cookie: cookieFor(MODS_READER) },
    });
    expect(installed.json().compat).toBe(true);
  });
});

describe("what reaches the client and the log", () => {
  const LEAK = "API POST /mods/compat → 500: ENOENT /home/mc/server/scripts sudo: password required\n[INFO] forged";

  it("does not echo a wrapper error body, and logs it on one line", async () => {
    startModCompatMock.mockRejectedValue(new Error(LEAK));
    const app = buildServer();
    const res = await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toMatch(/home|sudo|ENOENT|forged/);

    expect(logErrorMock).toHaveBeenCalled();
    const logged = logErrorMock.mock.calls.map((c) => c.join(" ")).join("\n");
    expect(logged.split("\n")).toHaveLength(logErrorMock.mock.calls.length);
    expect(logged).toContain("\\n[INFO] forged");
  });

  it("does not echo a poll failure", async () => {
    getModCompatMock.mockRejectedValue(new Error(LEAK));
    const app = buildServer();
    const res = await app.inject(get(MODS_READER, `/${JOB}`));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toMatch(/home|sudo|ENOENT|forged/);
  });

  it("answers 404 for a job the wrapper no longer has", async () => {
    getModCompatMock.mockResolvedValue(null);
    const app = buildServer();
    const res = await app.inject(get(MODS_READER, `/${JOB}`));
    expect(res.statusCode).toBe(404);
  });
});

describe("GET .../compat/versions", () => {
  it("lists Mojang releases", async () => {
    const app = buildServer();
    const res = await app.inject(get(MODS_READER, "/versions"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ versions: ["1.21.5", "1.21.4"] });
  });

  it("answers an empty list when Mojang is unreachable", async () => {
    fetchReleaseVersionsMock.mockResolvedValue(null);
    const app = buildServer();
    const res = await app.inject(get(MODS_READER, "/versions"));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ versions: [] });
  });
});

const DONE_JOB = {
  jobId: JOB,
  state: "done",
  mcVersion: "1.21.5",
  modLoader: "fabric",
  progress: { done: 1, total: 1 },
  partial: [],
  checkedAt: 1,
  complete: true,
  summary: { available: 1, unavailable: 0, unknown: 0, total: 1 },
  mods: [],
};

describe("resource caps through the routes", () => {
  it("returns the same job for a repeated start and refuses a second version with 409", async () => {
    const app = buildServer();
    const a = await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    const b = await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    expect(b.json()).toEqual(a.json());
    expect(startModCompatMock).toHaveBeenCalledTimes(1);
    const c = await app.inject(post(MODS_READER, { mcVersion: "1.20.1" }));
    expect(c.statusCode).toBe(409);
    expect(startModCompatMock).toHaveBeenCalledTimes(1);
  });

  it("refuses refresh spam while the own job runs, without reaching the wrapper", async () => {
    const app = buildServer();
    await app.inject(post(MODS_READER, { mcVersion: "1.21.5" }));
    for (let i = 0; i < 5; i++) {
      const r = await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }));
      expect(r.statusCode).toBe(409);
    }
    expect(startModCompatMock).toHaveBeenCalledTimes(1);
  });

  it("rate limits refresh per server once the first job finished", async () => {
    getModCompatMock.mockResolvedValue(DONE_JOB);
    const app = buildServer();
    await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }));
    await app.inject(get(MODS_READER, `/${JOB}`));
    const again = await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }));
    expect(again.statusCode).toBe(429);
    expect(startModCompatMock).toHaveBeenCalledTimes(1);
  });

  it("does not call the wrapper again for a job it already saw finish", async () => {
    getModCompatMock.mockResolvedValue(DONE_JOB);
    const app = buildServer();
    for (let i = 0; i < 10; i++) {
      expect((await app.inject(get(MODS_READER, `/${JOB}`))).statusCode).toBe(200);
    }
    expect(getModCompatMock).toHaveBeenCalledTimes(1);
  });

  it("many distinct job ids cost one wrapper call each", async () => {
    getModCompatMock.mockImplementation(async (_cfg: unknown, id: string) => ({
      ...DONE_JOB,
      jobId: id,
    }));
    const app = buildServer();
    for (let i = 0; i < 150; i++) {
      const id = "00000000-0000-4000-8000-" + String(i).padStart(12, "0");
      expect((await app.inject(get(MODS_READER, `/${id}`))).statusCode).toBe(200);
    }
    expect(getModCompatMock).toHaveBeenCalledTimes(150);
  });

  it("rejects an over-long or malformed version before any wrapper call or log line", async () => {
    const app = buildServer();
    const bad = ["1.21.5" + "x".repeat(40), "1.21\n[INFO] forged", "a b"];
    for (const v of bad) {
      const res = await app.inject(post(MODS_READER, { mcVersion: v }));
      expect(res.statusCode).toBe(400);
    }
    expect(startModCompatMock).not.toHaveBeenCalled();
    expect(logErrorMock).not.toHaveBeenCalled();
  });
});

describe("fairness between guilds and atomic admission", () => {
  const postAs = (uid: string, guild: string, server: string, mcVersion = "1.21.5") => ({
    method: "POST" as const,
    url: `/api/servers/${server}/mods/compat`,
    headers: { cookie: cookieFor(uid, [guild]), "content-type": "application/json" },
    payload: { mcVersion },
  });

  it("one guild filling its limit does not stop another guild", async () => {
    startModCompatMock.mockImplementation(async () => ({ jobId: crypto.randomUUID() }));
    const app = buildServer();
    expect((await app.inject(postAs(G1A, "g1", "smp"))).statusCode).toBe(200);
    expect((await app.inject(postAs(G1B, "g1", "other"))).statusCode).toBe(200);
    const third = await app.inject(postAs(G1C, "g1", "smp"));
    expect(third.statusCode).toBe(429);
    expect(third.json().error).toMatch(/guild/);
    expect((await app.inject(postAs(G2A, "g2", "smp"))).statusCode).toBe(200);
  });

  it("concurrent starts by one user reach the wrapper once and share the job", async () => {
    let release: () => void = () => undefined;
    startModCompatMock.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({ jobId: JOB }); }),
    );
    const app = buildServer();
    const all = Promise.all(
      Array.from({ length: 12 }, () => app.inject(post(MODS_READER, { mcVersion: "1.21.5" }))),
    );
    await vi.waitFor(() => expect(startModCompatMock).toHaveBeenCalled());
    release();
    const responses = await all;
    expect(startModCompatMock).toHaveBeenCalledTimes(1);
    expect(responses.map((r) => r.statusCode)).toEqual(Array(12).fill(200));
    expect(new Set(responses.map((r) => r.json().jobId))).toEqual(new Set([JOB]));
  });

  it("concurrent starts by many users of one guild are capped exactly", async () => {
    startModCompatMock.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return { jobId: crypto.randomUUID() };
    });
    const app = buildServer();
    const users = [G1A, G1B, G1C];
    const responses = await Promise.all(
      users.flatMap((u) => ["smp", "other"].map((srv) => app.inject(postAs(u, "g1", srv)))),
    );
    const ok = responses.filter((r) => r.statusCode === 200).length;
    expect(ok).toBe(2);
    expect(startModCompatMock).toHaveBeenCalledTimes(2);
    expect(responses.filter((r) => r.statusCode === 429)).toHaveLength(3);
  });

  it("a failed wrapper start frees the slot, so a retry works", async () => {
    startModCompatMock.mockRejectedValueOnce(new Error("wrapper down"));
    const app = buildServer();
    expect((await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }))).statusCode).toBe(502);
    const retry = await app.inject(post(MODS_READER, { mcVersion: "1.21.5", refresh: true }));
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual({ jobId: JOB });
  });
});
