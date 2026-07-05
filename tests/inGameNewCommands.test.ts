/**
 * New in-game commands: the greedy defineCommand extension plus the
 * handlers built on it (!report, !waypoint routing, !vote) and the
 * degradation paths of !slime / !deathpos.
 *
 * Same harness as inGameCommands.test.ts: registerLogCommand is mocked to
 * capture each command's regex + handler; unique usernames dodge the
 * shared cooldown map.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));
vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
}));
vi.mock("../src/bot/utils/guildRouter.js", () => ({
  serverInScope: vi.fn().mockReturnValue(true),
}));
vi.mock("../src/common/utils/linkUtils.js", () => ({
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
}));
vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

import { registerLogCommand } from "../src/bot/logWatcher/logWatcher.js";
import { loadConfig } from "../src/common/config.js";
import { loadJson } from "../src/common/utils/utils.js";
import { loadLinkedAccounts } from "../src/common/utils/linkUtils.js";
import { defineCommand } from "../src/bot/logWatcher/defineCommand.js";

type Handler = (
  m: RegExpExecArray,
  client: unknown,
  server: unknown,
) => Promise<void>;

function capture(): Promise<{ regex: RegExp; handler: Handler }> {
  return new Promise((resolve) => {
    vi.mocked(registerLogCommand).mockImplementationOnce((re, fn) => {
      resolve({ regex: re as RegExp, handler: fn as Handler });
    });
  });
}

let _uid = 0;
const nextUser = () => `TestUser${++_uid}`;

const chatLine = (user: string, msg: string) =>
  `[12:00:00] [Server thread/INFO]: <${user}> ${msg}`;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadConfig).mockReturnValue({
    language: "en",
    guilds: {},
  } as never);
  vi.mocked(loadLinkedAccounts).mockResolvedValue({});
});

// ── defineCommand greedy args ───────────────────────────────────────────────

describe("defineCommand greedy last argument", () => {
  it("captures the rest of the line (trailing whitespace trimmed)", async () => {
    const seen: Record<string, string>[] = [];
    const p = capture();
    defineCommand({
      name: "echoall",
      description: "t",
      args: ["message..."],
      cooldown: 0,
      handler: async (_u, args) => {
        seen.push(args);
      },
    }).init();
    const { regex, handler } = await p;

    const m = regex.exec(chatLine(nextUser(), "!echoall hello brave world  "));
    expect(m).not.toBeNull();
    await handler(m!, null, null);
    expect(seen[0]).toEqual({ message: "hello brave world" });
  });

  it("still requires at least one token", async () => {
    const p = capture();
    defineCommand({
      name: "echoall2",
      description: "t",
      args: ["message..."],
      handler: async () => {},
    }).init();
    const { regex } = await p;
    expect(regex.exec(chatLine(nextUser(), "!echoall2"))).toBeNull();
    expect(regex.exec(chatLine(nextUser(), "!echoall2 x"))).not.toBeNull();
  });

  it("throws at definition time when a greedy arg is not last", () => {
    expect(() =>
      defineCommand({
        name: "bad",
        description: "t",
        args: ["first...", "second"],
        handler: async () => {},
      }),
    ).toThrow(/must be the last argument/);
  });

  it("keeps single-token semantics for normal args", async () => {
    const p = capture();
    defineCommand({
      name: "single",
      description: "t",
      args: ["one"],
      handler: async () => {},
    }).init();
    const { regex } = await p;
    const m = regex.exec(chatLine(nextUser(), "!single alpha beta"));
    // Only the first token is captured — unchanged behavior.
    expect(m![3]).toBe("alpha");
  });
});

// ── !report ─────────────────────────────────────────────────────────────────

describe("!report handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../src/bot/logWatcher/commands/report.js")).init();
    ({ regex, handler } = await p);
  });

  const makeServer = () =>
    ({
      id: "smp",
      sendCommand: vi.fn().mockResolvedValue(undefined),
    }) as never;

  const makeClient = (send = vi.fn().mockResolvedValue(undefined)) =>
    ({ channels: { fetch: vi.fn().mockResolvedValue({ send }) } }) as never;

  it("posts an embed with mention to the configured guild channel", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      guilds: {
        g1: { reports: { channelId: "chan1", mentionRole: "role9" } },
      },
    } as never);
    const send = vi.fn().mockResolvedValue(undefined);
    const client = makeClient(send);
    const server = makeServer();

    const m = regex.exec(
      chatLine(nextUser(), "!report lava griefing at spawn shop"),
    )!;
    await handler(m, client, server);

    expect(send).toHaveBeenCalledTimes(1);
    const payload = send.mock.calls[0]![0] as {
      content?: string;
      embeds: Array<{ data: { description?: string; footer?: { text: string } } }>;
    };
    expect(payload.content).toBe("<@&role9>");
    expect(payload.embeds[0]!.data.description).toContain(
      "lava griefing at spawn shop",
    );
    expect(payload.embeds[0]!.data.footer?.text).toBe("smp");
    // Reporter got the green confirmation.
    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    expect(
      srv.sendCommand.mock.calls.some(([c]: [string]) =>
        c.startsWith("/tellraw"),
      ),
    ).toBe(true);
  });

  it("tells the reporter when no guild is configured for this server", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      guilds: {},
    } as never);
    const server = makeServer();

    const m = regex.exec(chatLine(nextUser(), "!report anything"))!;
    await handler(m, makeClient(), server);

    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    expect(srv.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("not set up"),
    );
  });

  it("strips control characters from the message body", async () => {
    vi.mocked(loadConfig).mockReturnValue({
      language: "en",
      guilds: { g1: { reports: { channelId: "chan1" } } },
    } as never);
    const send = vi.fn().mockResolvedValue(undefined);

    const m = regex.exec(chatLine(nextUser(), "!report bad\u0007stuff"))!;
    await handler(m, makeClient(send), makeServer());

    const payload = send.mock.calls[0]![0] as {
      embeds: Array<{ data: { description?: string } }>;
    };
    expect(payload.embeds[0]!.data.description).toBe("badstuff");
  });
});

// ── !waypoint routing ───────────────────────────────────────────────────────

describe("!waypoint handler routing", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../src/bot/logWatcher/commands/waypoint.js")).init();
    ({ regex, handler } = await p);
  });

  const makeServer = (store: unknown) => {
    vi.mocked(loadJson).mockResolvedValue(store);
    return {
      id: "smp",
      sendCommand: vi.fn().mockResolvedValue(undefined),
      getPlayerCoords: vi.fn().mockResolvedValue({ x: 10.7, y: 64, z: -3.2 }),
      getPlayerDimension: vi.fn().mockResolvedValue("overworld"),
    } as never;
  };

  it("`set <name>` stores floored coords under the lowercased key", async () => {
    const store = { version: 1, servers: {} };
    const server = makeServer(store);
    const user = nextUser();

    const m = regex.exec(chatLine(user, "!waypoint set GuardianFarm"))!;
    await handler(m, null, server);

    const wp = (
      store as { servers: Record<string, Record<string, { x: number; z: number; author: string }>> }
    ).servers["smp"]!["guardianfarm"]!;
    expect(wp).toMatchObject({ x: 10, z: -4, author: user });
  });

  it("rejects overwriting someone else's waypoint", async () => {
    const store = {
      version: 1,
      servers: {
        smp: {
          base: {
            name: "base",
            dimension: "overworld",
            x: 0,
            y: 0,
            z: 0,
            author: "SomeoneElse",
            createdAt: 1,
          },
        },
      },
    };
    const server = makeServer(store);

    const m = regex.exec(chatLine(nextUser(), "!waypoint set base"))!;
    await handler(m, null, server);

    expect(store.servers.smp.base.author).toBe("SomeoneElse");
    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    expect(srv.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("SomeoneElse"),
    );
  });

  it("looks up a waypoint case-insensitively", async () => {
    const server = makeServer({
      version: 1,
      servers: {
        smp: {
          spawn: {
            name: "Spawn",
            dimension: "overworld",
            x: 1,
            y: 2,
            z: 3,
            author: "Alice",
            createdAt: 1,
          },
        },
      },
    });

    const m = regex.exec(chatLine(nextUser(), "!waypoint SPAWN"))!;
    await handler(m, null, server);

    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    const sent = srv.sendCommand.mock.calls.map(([c]: [string]) => c).join("\n");
    expect(sent).toContain("1 / 2 / 3");
  });

  it("rejects unsafe names before touching coordinates", async () => {
    const server = makeServer({ version: 1, servers: {} });
    const m = regex.exec(chatLine(nextUser(), '!waypoint set bad"name'))!;
    await handler(m, null, server);
    const srv = server as {
      sendCommand: ReturnType<typeof vi.fn>;
      getPlayerCoords: ReturnType<typeof vi.fn>;
    };
    expect(srv.getPlayerCoords).not.toHaveBeenCalled();
    expect(srv.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("only contain"),
    );
  });
});

// ── !vote ───────────────────────────────────────────────────────────────────

describe("!vote handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../src/bot/logWatcher/commands/vote.js")).init();
    ({ regex, handler } = await p);
  });

  const pollStore = () => ({
    version: 1,
    polls: [
      {
        id: "p1",
        question: "Q?",
        options: ["A", "B"],
        guildId: "g",
        channelId: "c",
        messageId: "m",
        serverId: "smp",
        createdBy: "x",
        createdById: "1",
        createdAt: 1,
        endsAt: Date.now() + 60_000,
        votes: {} as Record<string, number>,
        status: "open" as const,
      },
    ],
  });

  const makeServer = () =>
    ({ id: "smp", sendCommand: vi.fn().mockResolvedValue(undefined) }) as never;

  it("records an in-game vote under the mc key for unlinked players", async () => {
    const store = pollStore();
    vi.mocked(loadJson).mockResolvedValue(store);
    const user = nextUser();

    const m = regex.exec(chatLine(user, "!vote 2"))!;
    await handler(m, null, makeServer());

    expect(store.polls[0]!.votes[`m:${user.toLowerCase()}`]).toBe(1);
  });

  it("collapses linked players onto their Discord key (cross-platform dedupe)", async () => {
    const store = pollStore();
    store.polls[0]!.votes["d:777"] = 0; // earlier button vote
    vi.mocked(loadJson).mockResolvedValue(store);
    const user = nextUser();
    vi.mocked(loadLinkedAccounts).mockResolvedValue({ "777": user });

    const m = regex.exec(chatLine(user, "!vote 2"))!;
    await handler(m, null, makeServer());

    // The button vote was overwritten, not duplicated.
    expect(store.polls[0]!.votes).toEqual({ "d:777": 1 });
  });

  it("rejects out-of-range options with a hint", async () => {
    const store = pollStore();
    vi.mocked(loadJson).mockResolvedValue(store);
    const server = makeServer();

    const m = regex.exec(chatLine(nextUser(), "!vote 9"))!;
    await handler(m, null, server);

    expect(store.polls[0]!.votes).toEqual({});
    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    expect(srv.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("between 1 and 2"),
    );
  });

  it("tells the player when no poll is open", async () => {
    vi.mocked(loadJson).mockResolvedValue({ version: 1, polls: [] });
    const server = makeServer();
    const m = regex.exec(chatLine(nextUser(), "!vote 1"))!;
    await handler(m, null, server);
    const srv = server as { sendCommand: ReturnType<typeof vi.fn> };
    expect(srv.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("no open poll"),
    );
  });
});

// ── !slime / !deathpos degradation paths ────────────────────────────────────

describe("!slime handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../src/bot/logWatcher/commands/slime.js")).init();
    ({ regex, handler } = await p);
  });

  it("answers with the chunk verdict in the overworld", async () => {
    const server = {
      getSeed: vi.fn().mockResolvedValue("12345"),
      getPlayerDimension: vi.fn().mockResolvedValue("overworld"),
      getPlayerCoords: vi.fn().mockResolvedValue({ x: 100, y: 64, z: -40 }),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
    const m = regex.exec(chatLine(nextUser(), "!slime"))!;
    await handler(m, null, server as never);
    // Chunk 6 / -3, verdict either way — the message names the chunk.
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("[6, -3]"),
    );
  });

  it("refuses outside the overworld without fetching coords", async () => {
    const server = {
      getSeed: vi.fn().mockResolvedValue("12345"),
      getPlayerDimension: vi.fn().mockResolvedValue("the_nether"),
      getPlayerCoords: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
    const m = regex.exec(chatLine(nextUser(), "!slime"))!;
    await handler(m, null, server as never);
    expect(server.getPlayerCoords).not.toHaveBeenCalled();
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("Overworld"),
    );
  });

  it("degrades gracefully when the seed is unavailable (screen server)", async () => {
    const server = {
      getSeed: vi.fn().mockResolvedValue(null),
      getPlayerDimension: vi.fn(),
      getPlayerCoords: vi.fn(),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
    const m = regex.exec(chatLine(nextUser(), "!slime"))!;
    await handler(m, null, server as never);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("Could not retrieve the world seed"),
    );
  });
});

describe("!deathpos handler", () => {
  let regex: RegExp, handler: Handler;

  beforeEach(async () => {
    const p = capture();
    (await import("../src/bot/logWatcher/commands/deathpos.js")).init();
    ({ regex, handler } = await p);
  });

  it("whispers the last death location", async () => {
    const server = {
      getLastDeathLocation: vi
        .fn()
        .mockResolvedValue({ x: -180, y: 63, z: 254, dimension: "overworld" }),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
    const m = regex.exec(chatLine(nextUser(), "!deathpos"))!;
    await handler(m, null, server as never);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("-180 / 63 / 254"),
    );
  });

  it("handles players who never died", async () => {
    const server = {
      getLastDeathLocation: vi.fn().mockResolvedValue(null),
      sendCommand: vi.fn().mockResolvedValue(undefined),
    };
    const m = regex.exec(chatLine(nextUser(), "!deathpos"))!;
    await handler(m, null, server as never);
    expect(server.sendCommand).toHaveBeenCalledWith(
      expect.stringContaining("No recorded death"),
    );
  });
});
