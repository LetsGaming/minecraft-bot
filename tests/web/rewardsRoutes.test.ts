/**
 * The daily-rewards editor's routes: who may read and write the shared pool
 * and a server's override, and that a stale or invalid save is refused.
 * Real reward files in a temp dir (MCBOT_REWARDS_DIR).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "fs";
import os from "os";
import path from "path";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const READER = "777777777777777777"; // server:read only
const READER_CFG = "888888888888888888"; // + config:read on smp
const EDITOR = "999999999999999990"; // + config:read + config:write on smp
const FLEET = "999999999999999991"; // config:read + config:write on every server


const mockConfig = {
  token: "t",
  clientId: "123456789012345678",
  adminUsers: [SYSADMIN],
  servers: { smp: { id: "smp", apiKey: "k-1" } },
  guilds: {},
  webui: {
    enabled: true,
    grants: {
      [READER]: { smp: ["server:read"] },
      [READER_CFG]: { smp: ["server:read", "config:read"] },
      [EDITOR]: { smp: ["server:read", "config:read", "config:write"] },
      [FLEET]: { "*": ["server:read", "config:read", "config:write"] },
    },
  },
};

const {
  indexConfigFilesMock,
  readConfigFileMock,
  writeConfigFileMock,
  revertConfigFileMock,
  detectCapabilitiesMock,
  getRemoteManifestMock,
  recordAdminActionMock,
  wrapperFeatureVersionMock,
} = vi.hoisted(() => ({
  wrapperFeatureVersionMock: vi.fn(async () => 2),
  indexConfigFilesMock: vi.fn(),
  readConfigFileMock: vi.fn(),
  writeConfigFileMock: vi.fn(),
  revertConfigFileMock: vi.fn(),
  detectCapabilitiesMock: vi.fn(),
  getRemoteManifestMock: vi.fn(),
  recordAdminActionMock: vi.fn(async () => {}),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp"]),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  detectCapabilities: detectCapabilitiesMock,
  getRemoteManifest: getRemoteManifestMock,
  indexConfigFiles: indexConfigFilesMock,
  readConfigFile: readConfigFileMock,
  writeConfigFile: writeConfigFileMock,
  revertConfigFile: revertConfigFileMock,
  wrapperFeatureVersion: wrapperFeatureVersionMock,
  sendCommand: vi.fn(),
  openLogStream: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
  runScript: vi.fn(),
  tailLog: vi.fn(async () => ""),
  listStatsUuids: vi.fn(async () => []),
  deleteStatsFile: vi.fn(),
  readWhitelist: vi.fn(async () => []),
  readUserCache: vi.fn(async () => []),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  // getHealth is required: collectStatus calls it first, and an instance
  // without it falls through to unknownStatus, which reports features: null
  // and would make these tests pass or fail for the wrong reason.
  getServerInstance: vi.fn((id: string) =>
    id === "smp"
      ? {
          id: "smp",
          config: { id: "smp", apiKey: "k-1" },
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



function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}


let dir: string;

beforeEach(() => {
  vi.clearAllMocks();
  dir = mkdtempSync(path.join(os.tmpdir(), "mcbot-rewards-routes-"));
  process.env.MCBOT_REWARDS_DIR = dir;
});

afterEach(() => {
  delete process.env.MCBOT_REWARDS_DIR;
  rmSync(dir, { recursive: true, force: true });
});

const get = (uid: string, url: string) => ({ method: "GET" as const, url, headers: { cookie: cookieFor(uid) } });
const put = (uid: string, url: string, payload: unknown) => ({
  method: "PUT" as const,
  url,
  headers: { cookie: cookieFor(uid), "content-type": "application/json" },
  payload,
});

describe("the shared pool", () => {
  it("is readable with a fleet-wide config:read, not with one server's", async () => {
    const app = buildServer();
    expect((await app.inject(get(EDITOR, "/api/rewards"))).statusCode).toBe(403);
    const res = await app.inject(get(FLEET, "/api/rewards"));
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.shared.pool.default.length).toBeGreaterThan(10);
    expect(body.shipped.default.length).toBe(body.shared.pool.default.length);
  });

  it("saves with the hash it was read with and audits the change", async () => {
    const app = buildServer();
    const { shared } = (await app.inject(get(SYSADMIN, "/api/rewards"))).json();
    const pool = { default: [{ item: "diamond", amount: 1, weight: 1 }] };
    const res = await app.inject(put(SYSADMIN, "/api/rewards", { baseHash: shared.hash, pool }));
    expect(res.statusCode).toBe(200);
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "daily rewards edit (dashboard)", detail: "shared pool: 1 items" }),
    );

    // The same hash again is stale now.
    const again = await app.inject(put(SYSADMIN, "/api/rewards", { baseHash: shared.hash, pool }));
    expect(again.statusCode).toBe(409);
  });

  it("refuses an invalid pool with the validator's list", async () => {
    const app = buildServer();
    const { shared } = (await app.inject(get(SYSADMIN, "/api/rewards"))).json();
    const res = await app.inject(put(SYSADMIN, "/api/rewards", { baseHash: shared.hash, pool: { default: [] } }));
    expect(res.statusCode).toBe(422);
    expect(res.json().errors).toContain("default: must hold at least one item");
  });

  it("cannot be written by someone holding config:write on one server only", async () => {
    const app = buildServer();
    const res = await app.inject(put(EDITOR, "/api/rewards", { baseHash: "x", pool: { default: [{ item: "a", amount: 1 }] } }));
    expect(res.statusCode).toBe(403);
  });
});

describe("a server's override", () => {
  it("needs config:read on that server and returns the shared pool to inherit from", async () => {
    const app = buildServer();
    expect((await app.inject(get(READER, "/api/servers/smp/rewards"))).statusCode).toBe(403);
    const res = await app.inject(get(READER_CFG, "/api/servers/smp/rewards"));
    expect(res.statusCode).toBe(200);
    expect(res.json().override).toMatchObject({ exists: false, hash: "absent", pool: {} });
    expect(res.json().shared.pool.default.length).toBeGreaterThan(10);
  });

  it("is writable with config:write on the server, and not with config:read", async () => {
    const app = buildServer();
    const pool = { bonusChance: 15 };
    expect((await app.inject(put(READER_CFG, "/api/servers/smp/rewards", { baseHash: "absent", pool }))).statusCode).toBe(403);
    const res = await app.inject(put(EDITOR, "/api/servers/smp/rewards", { baseHash: "absent", pool }));
    expect(res.statusCode).toBe(200);
    expect(existsSync(path.join(dir, "dailyRewards_smp.json"))).toBe(true);
    expect(recordAdminActionMock).toHaveBeenCalledWith(expect.objectContaining({ server: "smp", detail: "override: bonus 15 %" }));
  });

  it("is a 404 for a server that is not configured", async () => {
    const app = buildServer();
    expect((await app.inject(get(SYSADMIN, "/api/servers/nope/rewards"))).statusCode).toBe(404);
  });
});
