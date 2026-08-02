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
const ARCHIVIST = "888888888888888888"; // + backup:download
const RESTORER = "999999999999999999"; // + backup:restore

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
      [ARCHIVIST]: { smp: ["server:read", "backup:download"] },
      [RESTORER]: { smp: ["server:read", "backup:restore"] },
    },
  },
};

const {
  indexBackupFilesMock,
  openBackupDownloadMock,
  restoreBackupFileMock,
  recordAdminActionMock,
} = vi.hoisted(() => ({
  indexBackupFilesMock: vi.fn(),
  openBackupDownloadMock: vi.fn(),
  restoreBackupFileMock: vi.fn(),
  recordAdminActionMock: vi.fn(async () => {}),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
  getServerIds: vi.fn(() => ["smp"]),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  indexBackupFiles: indexBackupFilesMock,
  openBackupDownload: openBackupDownloadMock,
  restoreBackupFile: restoreBackupFileMock,
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
  getServerInstance: vi.fn((id: string) =>
    id === "smp" ? { config: { id: "smp", apiKey: "k-1" }, capabilities: null } : null,
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

const FILE_ID = "AbCdEfGhIjKlMnOpQrStUv";

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
  indexBackupFilesMock.mockResolvedValue({
    files: [
      { id: FILE_ID, tier: "hourly", name: "world-01.tar.zst", sizeBytes: 2048, mtimeMs: 1 },
    ],
    nextCursor: null,
    total: 1,
  });
  restoreBackupFileMock.mockResolvedValue({ output: "done", stderr: "", exitCode: 0 });
});

// ── The index ───────────────────────────────────────────────────────────────

describe("GET /api/servers/:id/backups/files", () => {
  it("lists archives for server:read", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/backups/files",
      headers: { cookie: cookieFor(READER) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().files[0].name).toBe("world-01.tar.zst");
  });

  it("passes the cursor and a clamped limit through", async () => {
    const app = buildServer();
    await app.inject({
      method: "GET",
      url: "/api/servers/smp/backups/files?cursor=abc&limit=99999",
      headers: { cookie: cookieFor(READER) },
    });
    expect(indexBackupFilesMock).toHaveBeenCalledWith(
      expect.anything(),
      { cursor: "abc", limit: 200 },
    );
  });

  it("401s without a session", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/backups/files",
    });
    expect(res.statusCode).toBe(401);
  });
});

// ── Download ────────────────────────────────────────────────────────────────

describe("GET .../backups/files/:fileId/download", () => {
  it("requires backup:download, not merely server:read", async () => {
    // Listing archives is metadata; taking one is the whole world leaving the
    // host. Different capabilities on purpose.
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(READER) },
    });
    expect(res.statusCode).toBe(403);
    expect(openBackupDownloadMock).not.toHaveBeenCalled();
  });

  it("streams the body through and forwards the headers", async () => {
    openBackupDownloadMock.mockResolvedValue(
      upstream(["chunk-a", "chunk-b"], {
        headers: {
          "content-length": "14",
          "content-disposition": 'attachment; filename="world-01.tar.zst"',
          "accept-ranges": "bytes",
          "content-type": "application/octet-stream",
        },
      }),
    );

    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("chunk-achunk-b");
    // Content-Length is what lets the browser draw its own progress bar, so
    // the dashboard needs no progress UI of its own.
    expect(res.headers["content-length"]).toBe("14");
    expect(res.headers["content-disposition"]).toContain("world-01.tar.zst");
    expect(res.headers["accept-ranges"]).toBe("bytes");
  });

  it("hands the reply a stream, never a buffer", async () => {
    // The property this route exists to get right: a 4 GB archive must pass
    // through in constant memory. A passing manual test proves nothing here,
    // because a small fixture fits in the heap either way — so assert on the
    // shape of what reaches the reply.
    let sent: unknown;
    openBackupDownloadMock.mockResolvedValue(upstream(["x"]));

    const app = buildServer();
    app.addHook("onSend", async (_req, _reply, payload) => {
      sent = payload;
      return payload;
    });

    await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST) },
    });

    expect(sent).toBeInstanceOf(Readable);
    expect(Buffer.isBuffer(sent)).toBe(false);
    expect(typeof sent).not.toBe("string");
  });

  it("forwards a Range request and its 206 response", async () => {
    openBackupDownloadMock.mockResolvedValue(
      upstream(["partial"], {
        status: 206,
        headers: { "content-range": "bytes 100-106/2048", "content-length": "7" },
      }),
    );

    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST), range: "bytes=100-106" },
    });

    expect(openBackupDownloadMock).toHaveBeenCalledWith(
      expect.anything(),
      FILE_ID,
      "bytes=100-106",
    );
    expect(res.statusCode).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 100-106/2048");
  });

  it("passes an upstream 416 through rather than flattening it", async () => {
    // The browser acts on a 416; turning every non-200 into a 502 would make
    // a resumable download look like a broken wrapper.
    openBackupDownloadMock.mockResolvedValue(
      upstream([], { status: 416, headers: { "content-range": "bytes */2048" } }),
    );
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST), range: "bytes=99999-" },
    });
    expect(res.statusCode).toBe(416);
  });

  it("404s when the wrapper does not know the archive", async () => {
    openBackupDownloadMock.mockResolvedValue(upstream([], { status: 404 }));
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST) },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s a malformed id before contacting the wrapper", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "GET",
      url: "/api/servers/smp/backups/files/short/download",
      headers: { cookie: cookieFor(ARCHIVIST) },
    });
    expect(res.statusCode).toBe(400);
    expect(openBackupDownloadMock).not.toHaveBeenCalled();
  });

  it("audits the download", async () => {
    openBackupDownloadMock.mockResolvedValue(upstream(["x"]));
    const app = buildServer();
    await app.inject({
      method: "GET",
      url: `/api/servers/smp/backups/files/${FILE_ID}/download`,
      headers: { cookie: cookieFor(ARCHIVIST) },
    });
    // A download leaves no trace on the server itself, so the audit log is
    // the only record that the world was taken.
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "backup download (dashboard)",
        server: "smp",
        byId: ARCHIVIST,
      }),
    );
  });
});

// ── Restore ─────────────────────────────────────────────────────────────────

describe("POST .../backups/files/:fileId/restore", () => {
  it("requires backup:restore", async () => {
    const app = buildServer();
    for (const uid of [READER, ARCHIVIST]) {
      const res = await app.inject({
        method: "POST",
        url: `/api/servers/smp/backups/files/${FILE_ID}/restore`,
        headers: { cookie: cookieFor(uid) },
      });
      expect(res.statusCode).toBe(403);
    }
    expect(restoreBackupFileMock).not.toHaveBeenCalled();
  });

  it("restores and reports the exit code", async () => {
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/servers/smp/backups/files/${FILE_ID}/restore`,
      headers: { cookie: cookieFor(RESTORER) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, exitCode: 0 });
  });

  it("reports a non-zero exit rather than pretending it worked", async () => {
    restoreBackupFileMock.mockResolvedValue({
      output: "",
      stderr: "no space left on device",
      exitCode: 1,
    });
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/servers/smp/backups/files/${FILE_ID}/restore`,
      headers: { cookie: cookieFor(RESTORER) },
    });
    expect(res.json()).toMatchObject({ ok: false, exitCode: 1 });
  });

  it("audits the attempt, not just the success", async () => {
    restoreBackupFileMock.mockRejectedValue(new Error("wrapper unreachable"));
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/servers/smp/backups/files/${FILE_ID}/restore`,
      headers: { cookie: cookieFor(RESTORER) },
    });
    expect(res.statusCode).toBe(502);
    // A restore that failed halfway is exactly when someone asks what ran.
    expect(recordAdminActionMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "backup restore (dashboard)" }),
    );
  });

  it("does not leak the upstream failure to the browser", async () => {
    restoreBackupFileMock.mockRejectedValue(
      new Error("API POST /backups/restore → 500: /home/mc/scripts/backup/restore.sh"),
    );
    const app = buildServer();
    const res = await app.inject({
      method: "POST",
      url: `/api/servers/smp/backups/files/${FILE_ID}/restore`,
      headers: { cookie: cookieFor(RESTORER) },
    });
    expect(res.body).not.toContain("/home/mc");
  });
});
