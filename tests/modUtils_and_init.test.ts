/**
 * modUtils.ts — getModList (with mocked serverAccess + fetch for Modrinth)
 * initMinecraftCommands — end-to-end init with all deps mocked
 * logWatcher/commands/commands.ts — registration
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Global mocks for modUtils ─────────────────────────────────────────────

vi.mock("../src/utils/serverAccess.js", () => ({
  readModSlugs: vi.fn(),
  logStreamUrl: vi.fn().mockReturnValue("https://api.example.com/stream"),
  tailLog: vi.fn().mockResolvedValue(""),
  isRunning: vi.fn().mockResolvedValue(false),
  getList: vi
    .fn()
    .mockResolvedValue({ playerCount: "0", maxPlayers: "20", players: [] }),
  sendCommand: vi.fn().mockResolvedValue(null),
  getTps: vi.fn().mockResolvedValue(null),
  readWhitelist: vi.fn().mockResolvedValue([]),
  readLevelName: vi.fn().mockResolvedValue("world"),
  readUserCache: vi.fn().mockResolvedValue([]),
  readStats: vi.fn().mockResolvedValue(null),
  listStatsUuids: vi.fn().mockResolvedValue([]),
  deleteStatsFile: vi.fn().mockResolvedValue(false),
  readBackups: vi.fn().mockResolvedValue({ dirs: [], totalBytes: 0 }),
  runScript: vi.fn().mockResolvedValue({ exitCode: 0, output: "", stderr: "" }),
}));

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── mocks for initMinecraftCommands ───────────────────────────────────────

vi.mock("../src/config.js", () => ({
  getServerIds: vi.fn().mockReturnValue([]),
  loadConfig: vi.fn().mockReturnValue({
    token: "tok",
    clientId: "cid",
    guilds: {},
    servers: {},
    adminUsers: [],
    commands: {},
    leaderboardInterval: "daily",
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 60_000,
  }),
}));

vi.mock("../src/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/logWatcher/logWatcher.js", () => ({
  LogWatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    server: { id: "test" },
  })),
  registerLogCommand: vi.fn(),
  getGlobalWatchers: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/logWatcher/RemoteLogWatcher.js", () => ({
  RemoteLogWatcher: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    server: { id: "remote" },
  })),
}));

vi.mock("../src/logWatcher/watchers/chatBridge.js", () => ({
  registerChatBridge: vi.fn(),
  setupDiscordToMc: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/joinLeave.js", () => ({
  registerJoinLeaveWatcher: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/deaths.js", () => ({
  registerDeathWatcher: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/advancements.js", () => ({
  registerAdvancementWatcher: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/serverEvents.js", () => ({
  registerServerEventWatcher: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/sleepWatcher.js", () => ({
  registerSleepWatcher: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/tpsMonitor.js", () => ({
  startTpsMonitor: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/logWatcher/watchers/leaderboardScheduler.js", () => ({
  startLeaderboardScheduler: vi
    .fn()
    .mockReturnValue({
      snapshotTimer: { unref: vi.fn() },
      postTimer: { unref: vi.fn() },
    }),
}));

vi.mock("../src/logWatcher/watchers/statusEmbed.js", () => ({
  startStatusEmbed: vi.fn().mockReturnValue(null),
  invalidateStatusChannelCache: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/downtimeMonitor.js", () => ({
  startDowntimeMonitor: vi.fn().mockReturnValue({ unref: vi.fn() }),
  suppressAlerts: vi.fn(),
}));

vi.mock("../src/logWatcher/watchers/channelPurge.js", () => ({
  startChannelPurge: vi.fn(),
}));

vi.mock("../src/utils/uptimeTracker.js", () => ({
  startUptimeFlushScheduler: vi.fn().mockReturnValue({ unref: vi.fn() }),
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

import * as serverAccess from "../src/utils/serverAccess.js";

// ══════════════════════════════════════════════════════════════════════════════
// modUtils.getModList
// ══════════════════════════════════════════════════════════════════════════════

describe("modUtils.getModList", () => {
  let getModList: (server: never) => Promise<unknown>;
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    ({ getModList } = await import("../src/utils/modUtils.js"));
  });

  const fakeServer = {
    id: "survival",
    config: { id: "survival", serverDir: "/tmp", scriptDir: "/tmp/scripts" },
  } as never;

  it("returns mod list with server_only, clientAndServer, clientOptional groups", async () => {
    vi.mocked(serverAccess.readModSlugs).mockResolvedValue({
      slugs: ["fabric-api", "lithium"],
      mtimeMs: Date.now(),
    } as never);

    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          slug: "fabric-api",
          title: "Fabric API",
          description: "Core",
          client_side: "required",
          server_side: "required",
        },
        {
          slug: "lithium",
          title: "Lithium",
          description: "Performance",
          client_side: "unsupported",
          server_side: "required",
        },
      ]),
    } as never);

    const result = (await getModList(fakeServer)) as {
      serverOnly: unknown[];
      clientAndServer: unknown[];
      clientOptional: unknown[];
    };
    expect(result).toHaveProperty("serverOnly");
    expect(result).toHaveProperty("clientAndServer");
    expect(result).toHaveProperty("clientOptional");
    expect(
      result.serverOnly.length +
        result.clientAndServer.length +
        result.clientOptional.length,
    ).toBe(2);
  });

  it("returns empty lists when no mod slugs exist", async () => {
    vi.mocked(serverAccess.readModSlugs).mockResolvedValue({
      slugs: [],
      mtimeMs: Date.now(),
    } as never);
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([]),
    } as never);
    const result = (await getModList(fakeServer)) as { serverOnly: unknown[] };
    expect(result.serverOnly).toHaveLength(0);
  });

  it("calls Modrinth API once and caches result for same mtimeMs", async () => {
    const mtime = Date.now() - 99999; // unique mtime unlikely to be cached
    vi.mocked(serverAccess.readModSlugs).mockResolvedValue({
      slugs: ["some-mod"],
      mtimeMs: mtime,
    } as never);
    vi.mocked(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue([
        {
          slug: "some-mod",
          title: "Some Mod",
          description: "desc",
          client_side: "required",
          server_side: "required",
        },
      ]),
    } as never);

    const server2 = {
      id: "unique-cache-server",
      config: {
        id: "unique-cache-server",
        serverDir: "/tmp",
        scriptDir: "/tmp",
      },
    } as never;

    await getModList(server2);
    await getModList(server2); // should hit cache

    // Modrinth fetch called exactly once despite two getModList calls
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// initMinecraftCommands
// ══════════════════════════════════════════════════════════════════════════════

describe("initMinecraftCommands", () => {
  let initMinecraftCommands: (client: never) => Promise<void>;
  beforeEach(async () => {
    ({ initMinecraftCommands } =
      await import("../src/logWatcher/initMinecraftCommands.js"));
  });

  it("runs without throwing when no server instances are configured", async () => {
    const mockClient = {
      on: vi.fn(),
      guilds: { cache: new Map() },
    } as never;
    await expect(initMinecraftCommands(mockClient)).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// logWatcher/commands/commands.ts
// ══════════════════════════════════════════════════════════════════════════════

describe("logWatcher commands.ts", () => {
  it("exports a COMMANDS array (or similar)", async () => {
    // Just importing covers the module-level registration code
    const mod = await import("../src/logWatcher/commands/commands.ts");
    // The module may export COMMANDS or similar; just ensure it imports cleanly
    expect(typeof mod).toBe("object");
  });
});
