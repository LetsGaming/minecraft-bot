/**
 * Config-reload reconciliation tests.
 *
 * Uses the REAL server.ts registry (instances with useRcon:false never open
 * sockets) and mocks the watcher layer so we can assert lifecycle calls:
 *  - added servers get an instance + a started LogWatcher + TPS monitor
 *  - removed servers get watcher.stop(), TPS timer cleared, instance dropped
 *  - changed-but-existing servers are reported, not touched
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/common/config.js", () => ({
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

// One stub watcher per construction so stop() can be asserted per server.
const createdWatchers: Array<{
  register: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  serverId: string;
}> = [];

vi.mock("../src/bot/logWatcher/logWatcher.js", () => ({
  // NOTE: must be a `function` (not an arrow) so `new LogWatcher(...)` works.
  LogWatcher: vi.fn().mockImplementation(function (server: { id: string }) {
    const w = {
      register: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn(),
      serverId: server.id,
    };
    createdWatchers.push(w);
    return w;
  }),
  registerLogCommand: vi.fn(),
  getGlobalWatchers: vi.fn().mockReturnValue([]),
}));

vi.mock("../src/bot/logWatcher/RemoteLogWatcher.js", () => ({
  RemoteLogWatcher: vi.fn(),
}));

vi.mock("../src/bot/logWatcher/watchers/chatBridge.js", () => ({
  registerChatBridge: vi.fn(),
  setupDiscordToMc: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/joinLeave.js", () => ({
  registerJoinLeaveWatcher: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/deaths.js", () => ({
  registerDeathWatcher: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/advancements.js", () => ({
  registerAdvancementWatcher: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/serverEvents.js", () => ({
  registerServerEventWatcher: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/sleepWatcher.js", () => ({
  registerSleepWatcher: vi.fn(),
}));

const tpsTimers: Array<ReturnType<typeof setInterval>> = [];
vi.mock("../src/bot/logWatcher/watchers/tpsMonitor.js", () => ({
  startTpsMonitor: vi.fn().mockImplementation(() => {
    const t = setInterval(() => {}, 1_000_000);
    t.unref();
    tpsTimers.push(t);
    return t;
  }),
}));

vi.mock("../src/bot/logWatcher/watchers/leaderboardScheduler.js", () => ({
  startLeaderboardScheduler: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/statusEmbed.js", () => ({
  startStatusEmbed: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/downtimeMonitor.js", () => ({
  startDowntimeMonitor: vi.fn(),
}));
vi.mock("../src/bot/logWatcher/watchers/channelPurge.js", () => ({
  startChannelPurge: vi.fn(),
}));
vi.mock("../src/common/utils/uptimeTracker.js", () => ({
  startUptimeFlushScheduler: vi.fn(),
}));

import { reconcileServers } from "../src/bot/logWatcher/initMinecraftCommands.js";
import {
  initServers,
  getAllInstances,
  getServerInstance,
  removeServerInstance,
} from "../src/common/utils/server.js";
import { startTpsMonitor } from "../src/bot/logWatcher/watchers/tpsMonitor.js";
import type { BotConfig, ServerConfig } from "../src/common/types/index.js";
import type { Client } from "discord.js";

const fakeClient = {} as Client;

function srvCfg(id: string, extra: Partial<ServerConfig> = {}): ServerConfig {
  return {
    id,
    serverDir: `/srv/${id}`,
    linuxUser: "mc",
    screenSession: id,
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
    ...extra,
  };
}

function botCfg(servers: Record<string, ServerConfig>): BotConfig {
  return {
    token: "tok",
    clientId: "cid",
    servers,
    guilds: {},
    adminUsers: [],
    commands: {},
    leaderboard: {},
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 60_000,
    leaderboardInterval: "daily",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createdWatchers.length = 0;
  for (const t of tpsTimers) clearInterval(t);
  tpsTimers.length = 0;
  // Empty the real registry between tests
  for (const inst of getAllInstances()) removeServerInstance(inst.id);
});

describe("reconcileServers", () => {
  it("adds a new server: instance registered, watcher started, TPS monitor wired", async () => {
    initServers({ survival: srvCfg("survival") });

    const result = await reconcileServers(
      fakeClient,
      botCfg({
        survival: srvCfg("survival"),
        creative: srvCfg("creative"),
      }),
    );

    expect(result.added).toEqual(["creative"]);
    expect(result.removed).toEqual([]);
    expect(getServerInstance("creative")).not.toBeNull();

    const w = createdWatchers.find((x) => x.serverId === "creative");
    expect(w).toBeDefined();
    expect(w!.start).toHaveBeenCalledOnce();
    expect(startTpsMonitor).toHaveBeenCalledWith(
      expect.objectContaining({ id: "creative" }),
      fakeClient,
      expect.anything(),
    );
  });

  it("removes a server: watcher stopped and instance dropped from the registry", async () => {
    initServers({
      survival: srvCfg("survival"),
      creative: srvCfg("creative"),
    });
    // Wire both via reconcile so handles exist for teardown
    await reconcileServers(
      fakeClient,
      botCfg({ survival: srvCfg("survival"), creative: srvCfg("creative") }),
    );
    // No watchers existed yet for pre-registered IDs — diff sees them as
    // unchanged. Re-register through an add to get tracked handles:
    for (const inst of getAllInstances()) removeServerInstance(inst.id);
    await reconcileServers(
      fakeClient,
      botCfg({ survival: srvCfg("survival"), creative: srvCfg("creative") }),
    );

    const result = await reconcileServers(
      fakeClient,
      botCfg({ survival: srvCfg("survival") }),
    );

    expect(result.removed).toEqual(["creative"]);
    expect(getServerInstance("creative")).toBeNull();
    expect(getServerInstance("survival")).not.toBeNull();

    const w = createdWatchers.find((x) => x.serverId === "creative");
    expect(w).toBeDefined();
    expect(w!.stop).toHaveBeenCalledOnce();
    // The surviving server's watcher keeps running
    const ws = createdWatchers.find((x) => x.serverId === "survival");
    expect(ws!.stop).not.toHaveBeenCalled();
  });

  it("reports changed settings on an existing ID without touching the instance", async () => {
    initServers({ survival: srvCfg("survival") });
    const before = getServerInstance("survival");

    const result = await reconcileServers(
      fakeClient,
      botCfg({ survival: srvCfg("survival", { rconPort: 25599 }) }),
    );

    expect(result.changed).toEqual(["survival"]);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    // Instance untouched — same object, original config
    expect(getServerInstance("survival")).toBe(before);
    expect(getServerInstance("survival")!.config.rconPort).toBe(25575);
  });

  it("is a no-op when the server list is unchanged", async () => {
    initServers({ survival: srvCfg("survival") });

    const result = await reconcileServers(
      fakeClient,
      botCfg({ survival: srvCfg("survival") }),
    );

    expect(result).toEqual({ added: [], removed: [], changed: [] });
    expect(createdWatchers).toHaveLength(0);
  });

  it("serializes concurrent reconciliations (reload command + file watcher)", async () => {
    initServers({ survival: srvCfg("survival") });
    const target = botCfg({
      survival: srvCfg("survival"),
      creative: srvCfg("creative"),
    });

    // Fire both reload paths "simultaneously" with the same fresh config
    const [a, b] = await Promise.all([
      reconcileServers(fakeClient, target),
      reconcileServers(fakeClient, target),
    ]);

    // Exactly one of them performs the add; the other sees a no-op diff
    expect([...a.added, ...b.added]).toEqual(["creative"]);
    expect(
      createdWatchers.filter((w) => w.serverId === "creative"),
    ).toHaveLength(1);
  });
});
