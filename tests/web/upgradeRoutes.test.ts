/**
 * The dashboard's version upgrade routes: the server:update capability and
 * server scope, the audit entry, the busy and unsupported answers, and that
 * progress reads only need server:read.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const UPDATER = "777777777777777777"; // server:update on smp
const READER = "888888888888888888"; // server:read only
const OTHER_UPDATER = "999999999999999990"; // server:update on another server

const mockConfig = {
  token: "t",
  clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { smp: { id: "smp", apiKey: "k-1" }, other: { id: "other", apiKey: "k-2" } },
  guilds: {},
  webui: {
    enabled: true,
    grants: {
      [UPDATER]: { smp: ["server:read", "server:update"] },
      [READER]: { smp: ["server:read"] },
      [OTHER_UPDATER]: { other: ["server:read", "server:update"] },
    },
  },
};

const {
  supportsUpgradeMock,
  startUpgradeMock,
  getUpgradeMock,
  getCurrentUpgradeMock,
  recordAdminActionMock,
} = vi.hoisted(() => ({
  supportsUpgradeMock: vi.fn(),
  startUpgradeMock: vi.fn(),
  getUpgradeMock: vi.fn(),
  getCurrentUpgradeMock: vi.fn(),
  recordAdminActionMock: vi.fn(async () => {}),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp", "other"]),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  supportsUpgrade: supportsUpgradeMock,
  startUpgrade: startUpgradeMock,
  getUpgrade: getUpgradeMock,
  getCurrentUpgrade: getCurrentUpgradeMock,
  detectCapabilities: vi.fn(async () => ({ scripts: {}, backups: true, restore: true, modManifest: true, variablesFile: true })),
  getRemoteManifest: vi.fn(async () => null),
  sendCommand: vi.fn(),
  openLogStream: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  runScript: vi.fn(),
  tailLog: vi.fn(async () => ""),
  listStatsUuids: vi.fn(async () => []),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(async () => []),
  readUserCache: vi.fn(async () => []),
  listInstalledMods: vi.fn(),
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
          getList: async () => ({ ok: true, value: { playerCount: 0, maxPlayers: 20, players: [] } }),
          getTps: async () => null,
        }
      : null,
  ),
  getAllInstances: vi.fn(() => []),
}));
vi.mock("../../src/core/utils/stores/adminAudit.js", () => ({
  loadAdminAudit: vi.fn(async () => []),
  recordAdminAction: recordAdminActionMock,
}));
vi.mock("../../src/core/utils/config/configService.js", () => ({
  withConfigWriteLock: <T>(fn: () => Promise<T>) => fn(),
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
vi.mock("../../src/core/utils/stores/uptimeTracker.js", () => ({ getUptimeStats: vi.fn(async () => ({})) }));
vi.mock("../../src/core/utils/server/hostResources.js", () => ({ getHostResources: vi.fn(async () => null) }));
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
import { ApiError } from "../../src/core/utils/server/access/apiClient.js";
import { busyKind } from "../../src/web/backend/routes/upgrades.js";

const JOB = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const VIEW = { jobId: JOB, state: "running", mcVersion: "1.21.5", events: [], next: 0 };

function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}

const post = (uid: string, payload: unknown, server = "smp") => ({
  method: "POST" as const,
  url: `/api/servers/${server}/upgrade`,
  headers: { cookie: cookieFor(uid), "content-type": "application/json" },
  payload: payload as object,
});
const get = (uid: string, path: string, server = "smp") => ({
  method: "GET" as const,
  url: `/api/servers/${server}/upgrade${path}`,
  headers: { cookie: cookieFor(uid) },
});

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhere(() => true);
  supportsUpgradeMock.mockResolvedValue(true);
  startUpgradeMock.mockResolvedValue({ jobId: JOB });
  getUpgradeMock.mockResolvedValue(VIEW);
  getCurrentUpgradeMock.mockResolvedValue(VIEW);
});

describe("capability and server scope", () => {
  it("starting needs server:update; server:read is refused", async () => {
    const app = buildServer();
    expect((await app.inject(post(READER, { mcVersion: "1.21.5" }))).statusCode).toBe(403);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });

  it("an update grant on another server does not reach this one", async () => {
    const app = buildServer();
    expect((await app.inject(post(OTHER_UPDATER, { mcVersion: "1.21.5" }))).statusCode).toBe(403);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });

  it("progress and support only need server:read", async () => {
    const app = buildServer();
    expect((await app.inject(get(READER, `/${JOB}`))).statusCode).toBe(200);
    expect((await app.inject(get(READER, "/current"))).statusCode).toBe(200);
    expect((await app.inject(get(READER, "/support"))).json()).toEqual({ supported: true });
  });

  it("a sysadmin implicitly holds server:update", async () => {
    const app = buildServer();
    expect((await app.inject(post(SYSADMIN, { mcVersion: "1.21.5" }))).statusCode).toBe(200);
  });
});

describe("POST /upgrade", () => {
  it("records the attempt, then starts the job with the shown mod set", async () => {
    const app = buildServer();
    const res = await app.inject(
      post(UPDATER, { mcVersion: "1.21.5", expectUnavailable: ["sodium"], countdownSeconds: 60 }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jobId: JOB });
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "server upgrade (dashboard)", server: "smp", detail: "1.21.5" }),
    );
    expect(startUpgradeMock).toHaveBeenCalledWith(expect.anything(), {
      mcVersion: "1.21.5",
      expectUnavailable: ["sodium"],
      countdownSeconds: 60,
    });
    expect(recordAdminActionMock.mock.invocationCallOrder[0]!).toBeLessThan(
      startUpgradeMock.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    {},
    { mcVersion: "../x" },
    { mcVersion: "1.21.5", countdownSeconds: 601 },
    { mcVersion: "1.21.5", expectUnavailable: [""] },
  ])("400s on %j", async (body) => {
    const app = buildServer();
    expect((await app.inject(post(UPDATER, body))).statusCode).toBe(400);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });

  it("501s without starting when the wrapper cannot upgrade", async () => {
    supportsUpgradeMock.mockResolvedValue(false);
    const app = buildServer();
    expect((await app.inject(post(UPDATER, { mcVersion: "1.21.5" }))).statusCode).toBe(501);
    expect(startUpgradeMock).not.toHaveBeenCalled();
  });

  it("409s with what holds the server when the wrapper answers 423", async () => {
    startUpgradeMock.mockRejectedValue(
      new ApiError("POST /operations/upgrade", 423, JSON.stringify({ error: "x", busy: { kind: "backup" } })),
    );
    const app = buildServer();
    const res = await app.inject(post(UPDATER, { mcVersion: "1.21.5" }));
    expect(res.statusCode).toBe(409);
    expect(res.json().message ?? res.json().error).toContain("backup");
  });

  it("409s with a scan-again message when the stored prune plan is gone", async () => {
    startUpgradeMock.mockRejectedValue(new ApiError("POST /operations/upgrade", 404, "{}"));
    const app = buildServer();
    const res = await app.inject(post(UPDATER, { mcVersion: "1.21.5", prunePlan: "0123456789abcdef" }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain("Scan again");
  });

  it("hides wrapper error text behind a fixed message", async () => {
    startUpgradeMock.mockRejectedValue(new Error("/home/mc/secret failed"));
    const app = buildServer();
    const res = await app.inject(post(UPDATER, { mcVersion: "1.21.5" }));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("secret");
  });
});

describe("polling", () => {
  it("passes the cursor on and 404s an unknown job", async () => {
    const app = buildServer();
    await app.inject(get(READER, `/${JOB}?since=7`));
    expect(getUpgradeMock).toHaveBeenCalledWith(expect.anything(), JOB, 7);
    getUpgradeMock.mockResolvedValue(null);
    expect((await app.inject(get(READER, `/${JOB}`))).statusCode).toBe(404);
  });

  it("answers current with no job when nothing has run, and rejects a malformed id or cursor", async () => {
    getCurrentUpgradeMock.mockResolvedValue(null);
    const app = buildServer();
    const none = await app.inject(get(READER, "/current"));
    expect(none.statusCode).toBe(200);
    expect(none.json()).toEqual({ job: null });
    expect((await app.inject(get(READER, "/not-a-job"))).statusCode).toBe(400);
    expect((await app.inject(get(READER, `/${JOB}?since=x`))).statusCode).toBe(400);
  });
});

describe("busyKind", () => {
  it("reads the holder out of a wrapper error message", () => {
    expect(busyKind('API POST /x → 423: {"busy":{"kind":"restore"}}')).toBe("restore");
    expect(busyKind("API POST /x → 423: not json")).toBe("another operation");
    expect(busyKind("no body at all")).toBe("another operation");
  });
});
