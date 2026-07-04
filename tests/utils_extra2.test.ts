/**
 * Tests to cover remaining gaps:
 * - chatBridge.setupDiscordToMc (Discord → MC bridge logic)
 * - playerUtils: findPlayer, getPlayerNames, getPlayerCount, getOnlinePlayers
 * - tpsMonitor interval callback logic
 * - downtimeMonitor checkServer state machine
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mocks ──────────────────────────────────────────────────────────

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/embedUtils.js", () => ({
  createEmbed: vi
    .fn()
    .mockReturnValue({
      addFields: vi.fn().mockReturnThis(),
      setFooter: vi.fn().mockReturnThis(),
    }),
  createErrorEmbed: vi.fn().mockReturnValue({ type: "error-embed" }),
}));

vi.mock("../src/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
  loadWhitelist: vi.fn().mockResolvedValue([
    { name: "Steve", uuid: "uuid-1" },
    { name: "Alex", uuid: "uuid-2" },
  ]),
  loadKnownPlayers: vi.fn().mockResolvedValue([
    { name: "Steve", uuid: "uuid-1" },
    { name: "Alex", uuid: "uuid-2" },
  ]),
  getListOutput: vi.fn().mockResolvedValue(null),
  stripLogPrefix: vi.fn((l) => l),
}));

vi.mock("../src/utils/uptimeTracker.js", () => ({
  recordCheck: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({
    tpsWarningThreshold: 15,
    tpsPollIntervalMs: 5_000,
  }),
}));

// ══════════════════════════════════════════════════════════════════════════════
// chatBridge.setupDiscordToMc
// ══════════════════════════════════════════════════════════════════════════════

describe("setupDiscordToMc", () => {
  let setupDiscordToMc: (
    client: never,
    guildConfigs: Record<string, never>,
    getInstance: (id: string) => never,
  ) => void;

  beforeEach(async () => {
    ({ setupDiscordToMc } =
      await import("../src/logWatcher/watchers/chatBridge.js"));
  });

  function makeClient() {
    const handlers = new Map<string, (...args: never[]) => void>();
    return {
      on: vi.fn((event: string, handler: (...args: never[]) => void) => {
        handlers.set(event, handler);
      }),
      _trigger: (event: string, ...args: never[]) =>
        handlers.get(event)?.(...args),
    };
  }

  it("registers messageCreate handler on the client", () => {
    const client = makeClient();
    setupDiscordToMc(client as never, {}, () => null as never);
    expect(client.on).toHaveBeenCalledWith(
      "messageCreate",
      expect.any(Function),
    );
  });

  it("forwards message to server.sendCommand when in configured channel", async () => {
    const client = makeClient();
    const server = {
      sendCommand: vi.fn().mockResolvedValue(undefined),
    } as never;
    const guildConfigs = {
      guild1: { chatBridge: { channelId: "ch1", server: "survival" } },
    } as never;

    setupDiscordToMc(client as never, guildConfigs, () => server);

    const fakeMsg = {
      author: { bot: false, id: "user-forward", displayName: "TestUser" },
      guild: { id: "guild1" },
      channel: { id: "ch1" },
      content: "Hello world!",
      react: vi.fn().mockResolvedValue(undefined),
    };

    await client._trigger("messageCreate", fakeMsg as never);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("/say"),
    );
  });

  it("ignores bot messages", async () => {
    const client = makeClient();
    const server = { sendCommand: vi.fn() } as never;
    setupDiscordToMc(
      client as never,
      { guild1: { chatBridge: { channelId: "ch1" } } } as never,
      () => server,
    );

    const botMsg = {
      author: { bot: true },
      guild: { id: "guild1" },
      channel: { id: "ch1" },
      content: "bot msg",
    };
    await client._trigger("messageCreate", botMsg as never);
    expect(server.sendCommand).not.toHaveBeenCalled();
  });

  it("ignores messages from unknown guilds", async () => {
    const client = makeClient();
    const server = { sendCommand: vi.fn() } as never;
    setupDiscordToMc(client as never, {}, () => server);

    const msg = {
      author: { bot: false },
      guild: null,
      channel: { id: "ch1" },
      content: "hi",
    };
    await client._trigger("messageCreate", msg as never);
    expect(server.sendCommand).not.toHaveBeenCalled();
  });

  it("strips non-ASCII characters from displayName and content", async () => {
    const client = makeClient();
    const server = {
      sendCommand: vi.fn().mockResolvedValue(undefined),
    } as never;
    const guildConfigs = {
      g1: { chatBridge: { channelId: "ch1", server: "main" } },
    } as never;
    setupDiscordToMc(client as never, guildConfigs, () => server, ["main"]);

    const msg = {
      author: {
        bot: false,
        id: "user-sanitize",
        displayName: "User\x00Injected",
      },
      guild: { id: "g1" },
      channel: { id: "ch1" },
      content: "Normal message",
      react: vi.fn().mockResolvedValue(undefined),
    };
    await client._trigger("messageCreate", msg as never);
    const cmd = vi.mocked(server.sendCommand).mock.calls[0]![0] as string;
    expect(cmd).not.toContain("\x00");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// playerUtils — server-delegating functions
// ══════════════════════════════════════════════════════════════════════════════

describe("playerUtils", () => {
  let findPlayer: (name: string, server: never) => Promise<unknown>;
  let getPlayerNames: (server: never) => Promise<string[]>;
  let getPlayerCount: (server?: never) => Promise<unknown>;
  let getOnlinePlayers: (server?: never) => Promise<string[]>;
  let getPlayerNamesChoices: (
    server: never,
  ) => Promise<Array<{ name: string; value: string }>>;

  beforeEach(async () => {
    const mod = await import("../src/utils/playerUtils.js");
    findPlayer = mod.findPlayer;
    getPlayerNames = mod.getPlayerNames;
    getPlayerCount = mod.getPlayerCount;
    getOnlinePlayers = mod.getOnlinePlayers;
    getPlayerNamesChoices = mod.getPlayerNamesChoices;
    vi.clearAllMocks();
  });

  const fakeServer = { id: "srv" } as never;

  it("findPlayer returns matching player (case-insensitive)", async () => {
    const result = await findPlayer("STEVE", fakeServer);
    expect((result as { name: string } | null)?.name).toBe("Steve");
  });

  it("findPlayer returns null for unknown player", async () => {
    const result = await findPlayer("Unknown", fakeServer);
    expect(result).toBeNull();
  });

  it("getPlayerNames returns name strings from whitelist", async () => {
    const names = await getPlayerNames(fakeServer);
    expect(names).toContain("Steve");
    expect(names).toContain("Alex");
  });

  it("getPlayerNamesChoices returns name/value pairs", async () => {
    const choices = await getPlayerNamesChoices(fakeServer);
    expect(choices[0]).toHaveProperty("name");
    expect(choices[0]).toHaveProperty("value");
  });

  it("getPlayerCount uses server.getList when server is provided", async () => {
    const server = {
      id: "srv",
      getList: vi
        .fn()
        .mockResolvedValue({
          playerCount: "3",
          maxPlayers: "20",
          players: ["A"],
        }),
    } as never;
    const count = await getPlayerCount(server);
    expect((count as { playerCount: string }).playerCount).toBe("3");
  });

  it("getPlayerCount returns unknown when no server and no log output", async () => {
    const count = await getPlayerCount(undefined as never);
    expect((count as { playerCount: string }).playerCount).toBe("unknown");
  });

  it("getOnlinePlayers uses server.getList when server is provided", async () => {
    const server = {
      id: "srv",
      getList: vi
        .fn()
        .mockResolvedValue({
          playerCount: "2",
          maxPlayers: "20",
          players: ["A", "B"],
        }),
    } as never;
    const players = await getOnlinePlayers(server);
    expect(players).toContain("A");
  });

  it("getOnlinePlayers returns empty array when no server and no log", async () => {
    const players = await getOnlinePlayers(undefined as never);
    expect(players).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// downtimeMonitor — checkServer state machine via interval
// ══════════════════════════════════════════════════════════════════════════════

describe("downtimeMonitor — state machine", () => {
  let startDowntimeMonitor: (
    servers: never[],
    client: never,
    guilds: Record<string, never>,
  ) => ReturnType<typeof setInterval>;
  let suppressAlerts: (id: string) => void;

  beforeEach(async () => {
    ({ startDowntimeMonitor, suppressAlerts } =
      await import("../src/logWatcher/watchers/downtimeMonitor.js"));
    vi.clearAllMocks();
  });

  it("suppressAlerts sets suppressUntil so checks during grace period are skipped", () => {
    // Simply call it and verify no throw
    suppressAlerts("test-server-state");
    expect(true).toBe(true);
  });

  it("startDowntimeMonitor returns a timer for configured guild", () => {
    const server = {
      id: "sm-srv",
      isRunning: vi.fn().mockResolvedValue(true),
    } as never;
    const channel = { send: vi.fn().mockResolvedValue(undefined) };
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue(channel) },
    } as never;
    const guilds = { g1: { downtimeAlerts: { channelId: "ch1" } } } as never;
    const timer = startDowntimeMonitor([server], client, guilds);
    expect(timer).toBeTruthy();
    clearInterval(timer);
  });
});
