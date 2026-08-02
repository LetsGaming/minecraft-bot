/**
 * DSH-03/DSH-04 — the backup panel's routes.
 *
 * The test that matters most is the streaming one. Everything else here is
 * ordinary capability and proxy behaviour; "the download is not buffered" is
 * the property that decides whether the first four-gigabyte world takes the
 * dashboard process down, and it is invisible in a passing manual test
 * because a small fixture fits in memory either way.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Readable } from "stream";

process.env.WEBUI_SESSION_SECRET = "unit-test-session-secret";
process.env.WEBUI_CLIENT_SECRET = "unit-test-client-secret";

const SYSADMIN = "111111111111111111";
const READER = "777777777777777777"; // server:read — sees the list, nothing else
const READER_CFG = "888888888888888888"; // + config:read
const EDITOR = "999999999999999990"; // + config:read + config:write


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
} = vi.hoisted(() => ({
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
  // without it falls through to unknownStatus — which reports features: null
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
import { clearFeatureCache } from "../../src/web/backend/status/status.js";

const FILE_ID = "AbCdEfGhIjKlMnOpQrStUv";

const TOML = `[general]
	#How many mobs may spawn per chunk.
	#Range: 1 ~ 64
	#Default: 8
	maxSpawnCount = 8
	#Allowed Values: PEACEFUL, EASY, NORMAL, HARD
	difficulty = "NORMAL"
`;

function cookieFor(uid: string): string {
  return `${SESSION_COOKIE}=${encodeSigned({
    uid,
    tag: `u-${uid}`,
    guilds: [],
    exp: Date.now() + 60_000,
    gexp: Date.now() + 60_000,
  })}`;
}

/** A wrapper response whose body is a stream of `chunks` bytes. */
function upstream(
  chunks: string[],
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers ?? {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // The probe is cached for five minutes, so without this each test would be
  // answered by whatever the first one happened to ask.
  clearFeatureCache();
  indexConfigFilesMock.mockResolvedValue([
    { id: FILE_ID, relPath: "config/jei-client.toml", modId: "jei",
      format: "toml", sizeBytes: 120, mtimeMs: 1 },
  ]);
  readConfigFileMock.mockResolvedValue({
    text: TOML,
    etag: "etag-1",
    file: { id: FILE_ID, relPath: "config/jei-client.toml", modId: "jei",
            format: "toml", sizeBytes: TOML.length, mtimeMs: 1 },
    snapshots: ["2026-08-02T09-00-00-000Z"],
  });
  writeConfigFileMock.mockResolvedValue({ ok: true, etag: "etag-2", snapshot: "snap-1" });
  revertConfigFileMock.mockResolvedValue({ etag: "etag-0" });
  detectCapabilitiesMock.mockResolvedValue({
    scripts: { start: true, stop: true, restart: true, rollback: true, backup: true, status: true },
    backups: true,
    restore: true,
    modManifest: true,
    variablesFile: true,
  });
  getRemoteManifestMock.mockResolvedValue({
    wrapper: "3.3.0",
    features: { "backup-files": { version: 1 }, "backup-restore": { version: 1 } },
  });
});


// ── The index ───────────────────────────────────────────────────────────────

describe("GET /api/servers/:id/configs", () => {
  it("requires config:read, which server:read alone does not grant", async () => {
    // This is the grant the whole capability system was built for: someone who
    // may tune a mod setting and nothing else. It has to be separable.
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/configs",
      headers: { cookie: cookieFor(READER) },
    });
    expect(res.statusCode).toBe(403);
    expect(indexConfigFilesMock).not.toHaveBeenCalled();
  });

  it("lists files for a config reader", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/configs",
      headers: { cookie: cookieFor(READER_CFG) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].modId).toBe("jei");
  });
});

// ── Reading: schema derivation is the point ─────────────────────────────────

describe("GET .../configs/:fileId", () => {
  it("derives form fields from the mod's own comments", async () => {
    // The reason this is worth building rather than shipping a text box:
    // Forge configs document themselves, so nobody hand-writes a schema.
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/configs/${FILE_ID}`,
      headers: { cookie: cookieFor(READER_CFG) },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    const spawn = body.fields.find((f: { path: string[] }) => f.path.at(-1) === "maxSpawnCount");
    expect(spawn).toMatchObject({ label: "Max spawn count", kind: "number", min: 1, max: 64 });
    expect(spawn.description).toBe("How many mobs may spawn per chunk.");

    const difficulty = body.fields.find((f: { path: string[] }) => f.path.at(-1) === "difficulty");
    expect(difficulty.options).toEqual(["PEACEFUL", "EASY", "NORMAL", "HARD"]);
    expect(body.etag).toBe("etag-1");
  });

  it("400s a malformed file id before contacting the wrapper", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/configs/short",
      headers: { cookie: cookieFor(READER_CFG) },
    });
    expect(res.statusCode).toBe(400);
    expect(readConfigFileMock).not.toHaveBeenCalled();
  });
});

// ── Writing ─────────────────────────────────────────────────────────────────

describe("PUT .../configs/:fileId", () => {
  const put = (uid: string, payload: unknown) =>
    ({ method: "PUT" as const, url: `/api/servers/smp/configs/${FILE_ID}`,
       headers: { cookie: cookieFor(uid), "content-type": "application/json" },
       payload });

  it("requires config:write, not merely config:read", async () => {
    const app = buildServer();
    const res = await app.inject(put(READER_CFG, {
      etag: "etag-1", edits: [{ path: ["general", "maxSpawnCount"], value: 32 }],
    }));
    expect(res.statusCode).toBe(403);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("splices the change and keeps every comment", async () => {
    // The property the whole editor rests on: a save changes the values that
    // changed and leaves the mod author's documentation byte-identical.
    const app = buildServer();
    const res = await app.inject(put(EDITOR, {
      etag: "etag-1", edits: [{ path: ["general", "maxSpawnCount"], value: 32 }],
    }));
    expect(res.statusCode).toBe(200);

    const written = writeConfigFileMock.mock.calls[0]?.[2] as string;
    expect(written).toContain("maxSpawnCount = 32");
    expect(written).toContain("#Range: 1 ~ 64");
    expect(written).toContain("#Allowed Values: PEACEFUL, EASY, NORMAL, HARD");
    expect(written).toContain('difficulty = "NORMAL"');
    expect(written.split("\n").length).toBe(TOML.split("\n").length);
  });

  it("refuses a write against a stale etag without touching the file", async () => {
    // A mod that rewrote its own config at shutdown is the realistic case.
    const app = buildServer();
    const res = await app.inject(put(EDITOR, {
      etag: "etag-from-an-hour-ago",
      edits: [{ path: ["general", "maxSpawnCount"], value: 32 }],
    }));
    expect(res.statusCode).toBe(409);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("rejects an edit to a key that is not in the file", async () => {
    const app = buildServer();
    const res = await app.inject(put(EDITOR, {
      etag: "etag-1", edits: [{ path: ["general", "notAKey"], value: 1 }],
    }));
    expect(res.statusCode).toBe(400);
    expect(writeConfigFileMock).not.toHaveBeenCalled();
  });

  it("never accepts a whole document from the client", async () => {
    // The client sends values; the server re-reads and splices. Posting text
    // would make every guard in the writer decorative.
    const app = buildServer();
    const res = await app.inject(put(EDITOR, { etag: "etag-1", text: "anything" }));
    expect(res.statusCode).toBe(400);
  });

  it("audits the edit with what changed", async () => {
    const app = buildServer();
    await app.inject(put(EDITOR, {
      etag: "etag-1", edits: [{ path: ["general", "difficulty"], value: "HARD" }],
    }));
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "mod config edit (dashboard)",
        server: "smp",
        byId: EDITOR,
        detail: expect.stringContaining("general.difficulty"),
      }),
    );
  });

  it("reports a conflict raised by the wrapper as a conflict", async () => {
    writeConfigFileMock.mockResolvedValue({ ok: false, conflict: true });
    const app = buildServer();
    const res = await app.inject(put(EDITOR, {
      etag: "etag-1", edits: [{ path: ["general", "maxSpawnCount"], value: 5 }],
    }));
    expect(res.statusCode).toBe(409);
  });
});

// ── Revert ──────────────────────────────────────────────────────────────────

describe("POST .../configs/:fileId/revert", () => {
  it("requires config:write and is audited", async () => {
    const app = buildServer();
    const denied = await app.inject({
      method: "POST", url: `/api/servers/smp/configs/${FILE_ID}/revert`,
      headers: { cookie: cookieFor(READER_CFG), "content-type": "application/json" },
      payload: { snapshot: "2026-08-02T09-00-00-000Z" },
    });
    expect(denied.statusCode).toBe(403);

    const ok = await app.inject({
      method: "POST", url: `/api/servers/smp/configs/${FILE_ID}/revert`,
      headers: { cookie: cookieFor(EDITOR), "content-type": "application/json" },
      payload: { snapshot: "2026-08-02T09-00-00-000Z" },
    });
    expect(ok.statusCode).toBe(200);
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "mod config revert (dashboard)" }),
    );
  });
});
