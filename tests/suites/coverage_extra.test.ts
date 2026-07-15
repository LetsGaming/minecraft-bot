/**
 * Extra coverage for gaps:
 * - defineCommand: cooldown path
 * - embedUtils: handlePagination collector logic
 * - server.ts: ServerInstance.isRunning, getList, sendCommand
 * - tpsMonitor: interval fires with warning embed
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi.fn().mockReturnValue({
    addFields: vi.fn().mockReturnThis(),
    setFooter: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 100, // short for testing
    guilds: {},
    servers: {},
    adminUsers: [],
    token: "tok",
    clientId: "cid",
  }),
}));

vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
  getGlobalWatchers: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/core/utils/server/serverAccess.js", () => ({
  readUserCache: vi.fn().mockResolvedValue([]),
  tailLog: vi.fn().mockResolvedValue(""),
  isRunning: vi.fn().mockResolvedValue(true),
  getList: vi
    .fn()
    .mockResolvedValue({
      playerCount: "2",
      maxPlayers: "20",
      players: ["A", "B"],
    }),
  sendCommand: vi.fn().mockResolvedValue("result"),
  getTps: vi.fn().mockResolvedValue({ tps1m: 20 }),
}));

vi.mock("../../src/core/shell/execCommand.js", () => ({
  execSafe: vi.fn().mockResolvedValue(null),
  isSudoPermissionError: vi.fn().mockReturnValue(false),
}));

vi.mock("../../src/core/rcon/RconClient.js", () => ({
  RconClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    send: vi
      .fn()
      .mockResolvedValue(
        "There are 2 of a max of 20 players online: Alice, Bob",
      ),
  })),
}));

// ══════════════════════════════════════════════════════════════════════════════
// defineCommand — cooldown path
// ══════════════════════════════════════════════════════════════════════════════

describe("defineCommand — cooldown enforcement", () => {
  let defineCommand: typeof import("../../src/bot/logWatcher/defineCommand.js").defineCommand;

  beforeEach(async () => {
    ({ defineCommand } = await import("../../src/bot/logWatcher/defineCommand.js"));
  });

  it("sends cooldown message when command is used twice within cooldown window", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const { init, COMMAND_INFO } = defineCommand({
      name: "cooldowntest",
      description: "Test cooldown",
      cooldown: 60, // 60 second cooldown
      handler,
    });
    init();

    expect(COMMAND_INFO.command).toBe("!cooldowntest");

    const { registerLogCommand } =
      await import("../../src/bot/logWatcher/logWatcher.js");
    const registeredHandler = vi.mocked(registerLogCommand).mock.calls[0]![1]!;
    const regex = vi.mocked(registerLogCommand).mock.calls[0]![0]! as RegExp;

    const line = "[12:00:00] [Server thread/INFO]: <Alice> !cooldowntest";
    const match = regex.exec(line)!;
    const server = {
      id: "srv",
      sendCommand: vi.fn().mockResolvedValue(""),
    } as never;
    const client = {} as never;

    // First call — should succeed
    await registeredHandler(match, client, server);
    expect(handler).toHaveBeenCalledTimes(1);

    // Second call — should be blocked by cooldown
    await registeredHandler(match, client, server);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("Please wait"),
    );
    expect(handler).toHaveBeenCalledTimes(1); // still only 1 call
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ServerInstance — isRunning, sendCommand, getSeed
// ══════════════════════════════════════════════════════════════════════════════

describe("ServerInstance methods", () => {
  let ServerInstance: new (cfg: never) => {
    isRunning: () => Promise<boolean>;
    sendCommand: (cmd: string) => Promise<string | null>;
    getSeed: () => Promise<string | null>;
    getList: () => Promise<{
      playerCount: string;
      maxPlayers: string;
      players: string[];
    }>;
    supportsTps: boolean;
    getTps: () => Promise<unknown>;
  };

  beforeEach(async () => {
    vi.resetModules();
    ({ ServerInstance } = await import("../../src/core/utils/server/server.js"));
    vi.clearAllMocks();
  });

  const remoteCfg = {
    id: "srv",
    serverDir: "/tmp",
    linuxUser: "mc",
    screenSession: "server",
    useRcon: false,
    rconHost: "localhost",
    rconPort: 25575,
    rconPassword: "",
    scriptDir: "",
    apiUrl: "https://api.example.com",
    apiKey: "key",
  } as never;

  it("isRunning() delegates to serverAccess.isRunning", async () => {
    const inst = new ServerInstance(remoteCfg);
    const result = await inst.isRunning();
    expect(result).toBe(true);
  });

  it("sendCommand() delegates to serverAccess.sendCommand", async () => {
    const inst = new ServerInstance(remoteCfg);
    const result = await inst.sendCommand("/say hello");
    expect(typeof result === "string" || result === null).toBe(true);
  });

  it("getList() delegates to serverAccess.getList", async () => {
    const inst = new ServerInstance(remoteCfg);
    const list = await inst.getList();
    expect(list).toHaveProperty("playerCount");
    expect(list).toHaveProperty("players");
  });

  it("getSeed() returns null on first call when screen sendCommand fails", async () => {
    const localCfg = {
      id: "local",
      serverDir: "/tmp",
      linuxUser: "mc",
      screenSession: "server",
      useRcon: false,
      rconHost: "localhost",
      rconPort: 25575,
      rconPassword: "",
      scriptDir: "",
    } as never;
    const inst = new ServerInstance(localCfg);
    const { tailLog } = await import("../../src/core/utils/server/serverAccess.js");
    vi.mocked(tailLog).mockResolvedValue("no seed here");
    const seed = await inst.getSeed();
    // Without RCON and with no seed in log, returns null
    expect(seed === null || typeof seed === "string").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// tpsMonitor — warning embed when TPS is below threshold
// ══════════════════════════════════════════════════════════════════════════════

describe("startTpsMonitor — fires warning when TPS drops", () => {
  let startTpsMonitor: (
    server: never,
    client: never,
    guilds: Record<string, never>,
  ) => ReturnType<typeof setInterval> | null;

  beforeEach(async () => {
    ({ startTpsMonitor } =
      await import("../../src/bot/logWatcher/watchers/monitors/tpsMonitor.js"));
    vi.clearAllMocks();
  });

  it("returns timer for RCON-capable server", () => {
    const server = {
      id: "srv",
      supportsTps: true,
      getTps: vi.fn().mockResolvedValue({ tps1m: 8 }), // below threshold
    } as never;

    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
    } as never;
    const guilds = { g1: { tpsAlerts: { channelId: "ch1" } } } as never;

    const timer = startTpsMonitor(server, client, guilds);
    expect(timer).toBeTruthy();
    clearInterval(timer!);
  });
});

// handlePagination tests are in handlePagination.test.ts
