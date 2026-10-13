/**
 * The dashboard's chunk prune routes: the server:update capability and server
 * scope, parameter validation, the unsupported and busy answers, and that
 * wrapper error text never reaches the client.
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
  supportsPruneMock,
  startPruneScanMock,
  getPruneScanMock,
  getPruneDimensionsMock,
  getPruneStatusMock,
  cancelPruneScanMock,
  getPruneSettingsMock,
  setPruneSettingsMock,
  getPruneMapMock,
  startPruneMock,
  recordAdminActionMock,
} = vi.hoisted(() => ({
  supportsPruneMock: vi.fn(),
  startPruneScanMock: vi.fn(),
  getPruneScanMock: vi.fn(),
  getPruneDimensionsMock: vi.fn(),
  getPruneStatusMock: vi.fn(),
  cancelPruneScanMock: vi.fn(),
  getPruneSettingsMock: vi.fn(),
  setPruneSettingsMock: vi.fn(),
  getPruneMapMock: vi.fn(),
  startPruneMock: vi.fn(),
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
  supportsPrune: supportsPruneMock,
  startPruneScan: startPruneScanMock,
  getPruneScan: getPruneScanMock,
  getPruneDimensions: getPruneDimensionsMock,
  getPruneStatus: getPruneStatusMock,
  cancelPruneScan: cancelPruneScanMock,
  getPruneSettings: getPruneSettingsMock,
  setPruneSettings: setPruneSettingsMock,
  getPruneMap: getPruneMapMock,
  startPrune: startPruneMock,
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
          getList: async () => ({ playerCount: 0, maxPlayers: 20, players: [] }),
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

const JOB = "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const PLAN = "0123456789abcdef";

function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}


const req = (method: "GET" | "POST" | "PUT", uid: string, urlPath: string, payload?: unknown) => ({
  method,
  url: `/api/servers/smp${urlPath}`,
  headers: { cookie: cookieFor(uid), ...(payload !== undefined ? { "content-type": "application/json" } : {}) },
  ...(payload !== undefined ? { payload: payload as object } : {}),
});

const PARAMS = { thresholdMinutes: 5, spawnRadiusChunks: 16, playerRadiusChunks: 8, bufferChunks: 2, zones: [], dimensions: null };

beforeEach(() => {
  vi.clearAllMocks();
  invalidateWhere(() => true);
  supportsPruneMock.mockResolvedValue(true);
  startPruneScanMock.mockResolvedValue({ jobId: JOB });
  getPruneScanMock.mockResolvedValue({ jobId: JOB, state: "running" });
  getPruneSettingsMock.mockResolvedValue(PARAMS);
  setPruneSettingsMock.mockImplementation(async (_cfg: unknown, p: object) => ({ ...PARAMS, ...p }));
  getPruneMapMock.mockResolvedValue({ dimension: "overworld", regions: {} });
  getPruneDimensionsMock.mockResolvedValue({ dimensions: [{ id: "overworld", regions: 4 }] });
  getPruneStatusMock.mockResolvedValue({ engine: "builtin", version: 1 });
  cancelPruneScanMock.mockResolvedValue(true);
  startPruneMock.mockResolvedValue({ jobId: JOB });
});

describe("capability and server scope", () => {
  it("every prune action needs server:update", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", READER, "/prune/settings"))).statusCode).toBe(403);
    expect((await app.inject(req("GET", READER, "/prune/dimensions"))).statusCode).toBe(403);
    expect((await app.inject(req("GET", READER, "/prune/status"))).statusCode).toBe(403);
    expect((await app.inject(req("POST", READER, `/prune/scans/${JOB}/cancel`, {}))).statusCode).toBe(403);
    expect((await app.inject(req("PUT", READER, "/prune/settings", {}))).statusCode).toBe(403);
    expect((await app.inject(req("POST", READER, "/prune/scans", {}))).statusCode).toBe(403);
    expect((await app.inject(req("GET", READER, `/prune/scans/${JOB}`))).statusCode).toBe(403);
    expect((await app.inject(req("GET", READER, `/prune/plans/${PLAN}/map/0`))).statusCode).toBe(403);
    expect((await app.inject(req("POST", READER, "/prune", { planId: PLAN }))).statusCode).toBe(403);
    expect(startPruneScanMock).not.toHaveBeenCalled();
    expect(startPruneMock).not.toHaveBeenCalled();
  });

  it("an update grant on another server does not reach this one", async () => {
    const app = buildServer();
    expect((await app.inject(req("POST", OTHER_UPDATER, "/prune", { planId: PLAN }))).statusCode).toBe(403);
    expect(startPruneMock).not.toHaveBeenCalled();
  });

  it("support only needs server:read", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", READER, "/prune/support"))).json()).toEqual({ supported: true });
  });
});

describe("unsupported wrapper", () => {
  it("501s every action that would reach it", async () => {
    supportsPruneMock.mockResolvedValue(false);
    const app = buildServer();
    expect((await app.inject(req("GET", UPDATER, "/prune/settings"))).statusCode).toBe(501);
    expect((await app.inject(req("POST", UPDATER, "/prune/scans", {}))).statusCode).toBe(501);
    expect((await app.inject(req("POST", UPDATER, "/prune", { planId: PLAN }))).statusCode).toBe(501);
    expect(startPruneScanMock).not.toHaveBeenCalled();
    expect(startPruneMock).not.toHaveBeenCalled();
  });
});

describe("settings and scans", () => {
  it("reads and saves the parameters", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", UPDATER, "/prune/settings"))).json()).toEqual(PARAMS);
    const put = await app.inject(req("PUT", UPDATER, "/prune/settings", { thresholdMinutes: 12, bufferChunks: 3 }));
    expect(put.statusCode).toBe(200);
    expect(setPruneSettingsMock).toHaveBeenCalledWith(expect.anything(), { thresholdMinutes: 12, bufferChunks: 3 });
  });

  it.each([
    { thresholdMinutes: -1 },
    { bufferChunks: 99 },
    { zones: [{ name: "x", dimension: "Bad Name", x1: 0, z1: 0, x2: 1, z2: 1 }] },
    { dimensions: ["../x"] },
  ])("400s %j", async (body) => {
    const app = buildServer();
    expect((await app.inject(req("PUT", UPDATER, "/prune/settings", body))).statusCode).toBe(400);
    expect(setPruneSettingsMock).not.toHaveBeenCalled();
  });

  it("starts a scan with the given parameters and polls it", async () => {
    const app = buildServer();
    const started = await app.inject(req("POST", UPDATER, "/prune/scans", { thresholdMinutes: 30 }));
    expect(started.json()).toEqual({ jobId: JOB });
    expect(startPruneScanMock).toHaveBeenCalledWith(expect.anything(), { thresholdMinutes: 30 });
    expect((await app.inject(req("GET", UPDATER, `/prune/scans/${JOB}`))).json()).toMatchObject({ state: "running" });
  });

  it("409s a second scan and 404s an expired one", async () => {
    startPruneScanMock.mockRejectedValue(new ApiError("POST /prune/scans", 429, "{}"));
    const app = buildServer();
    expect((await app.inject(req("POST", UPDATER, "/prune/scans", {}))).statusCode).toBe(409);
    getPruneScanMock.mockResolvedValue(null);
    expect((await app.inject(req("GET", UPDATER, `/prune/scans/${JOB}`))).statusCode).toBe(404);
  });

  it("hides wrapper error text", async () => {
    startPruneScanMock.mockRejectedValue(new Error("/home/mc/secret failed"));
    const app = buildServer();
    const res = await app.inject(req("POST", UPDATER, "/prune/scans", {}));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("secret");
  });
});

describe("dimensions, status and cancel", () => {
  it("lists the dimensions and reports the engine status", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", UPDATER, "/prune/dimensions"))).json()).toEqual({ dimensions: [{ id: "overworld", regions: 4 }] });
    expect((await app.inject(req("GET", UPDATER, "/prune/status"))).json()).toEqual({ engine: "builtin", version: 1 });
  });

  it("cancels a running scan and 404s one that is not running", async () => {
    const app = buildServer();
    expect((await app.inject(req("POST", UPDATER, `/prune/scans/${JOB}/cancel`, {}))).json()).toEqual({ cancelled: true });
    expect(cancelPruneScanMock).toHaveBeenCalledWith(expect.anything(), JOB);
    cancelPruneScanMock.mockResolvedValue(false);
    expect((await app.inject(req("POST", UPDATER, `/prune/scans/${JOB}/cancel`, {}))).statusCode).toBe(404);
  });

  it("501s when the wrapper cannot prune, and hides wrapper errors", async () => {
    getPruneDimensionsMock.mockRejectedValue(new Error("/home/mc/secret failed"));
    const app = buildServer();
    const res = await app.inject(req("GET", UPDATER, "/prune/dimensions"));
    expect(res.statusCode).toBe(502);
    expect(res.body).not.toContain("secret");
    supportsPruneMock.mockResolvedValue(false);
    invalidateWhere(() => true);
    expect((await app.inject(req("GET", UPDATER, "/prune/status"))).statusCode).toBe(501);
  });
});

describe("maps", () => {
  it("returns a dimension map and 404s an expired plan", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", UPDATER, `/prune/plans/${PLAN}/map/0`))).json().dimension).toBe("overworld");
    expect(getPruneMapMock).toHaveBeenCalledWith(expect.anything(), PLAN, 0);
    getPruneMapMock.mockResolvedValue(null);
    expect((await app.inject(req("GET", UPDATER, `/prune/plans/${PLAN}/map/0`))).statusCode).toBe(404);
  });

  it("400s a malformed plan or index", async () => {
    const app = buildServer();
    expect((await app.inject(req("GET", UPDATER, "/prune/plans/zz/map/0"))).statusCode).toBe(400);
    expect((await app.inject(req("GET", UPDATER, `/prune/plans/${PLAN}/map/x`))).statusCode).toBe(400);
  });
});

describe("POST /prune", () => {
  it("records the attempt, then starts the job for the plan", async () => {
    const app = buildServer();
    const res = await app.inject(req("POST", UPDATER, "/prune", { planId: PLAN, countdownSeconds: 20 }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ jobId: JOB });
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "chunk prune (dashboard)", server: "smp", detail: PLAN }),
    );
    expect(startPruneMock).toHaveBeenCalledWith(expect.anything(), PLAN, 20);
    expect(recordAdminActionMock.mock.invocationCallOrder[0]!).toBeLessThan(startPruneMock.mock.invocationCallOrder[0]!);
  });

  it.each([{}, { planId: "short" }, { planId: PLAN, countdownSeconds: 601 }])("400s %j", async (body) => {
    const app = buildServer();
    expect((await app.inject(req("POST", UPDATER, "/prune", body))).statusCode).toBe(400);
    expect(startPruneMock).not.toHaveBeenCalled();
  });

  it("409s with what holds the server when the wrapper answers 423", async () => {
    startPruneMock.mockRejectedValue(new ApiError("POST /operations/prune", 423, JSON.stringify({ busy: { kind: "upgrade" } })));
    const app = buildServer();
    const res = await app.inject(req("POST", UPDATER, "/prune", { planId: PLAN }));
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain("upgrade");
  });
});
