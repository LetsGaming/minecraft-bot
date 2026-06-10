/**
 * Watcher tests — two layers:
 *  1. Regex patterns: verify the compiled regexes match / reject the right log lines
 *  2. Registration: verify registerXxxWatcher adds the right number of handlers
 *     and that those handlers can be called with mock Discord objects
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Logger mock ────────────────────────────────────────────────────────────
vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── embedUtils mock ────────────────────────────────────────────────────────
vi.mock("../src/utils/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
  createEmbed: vi.fn().mockReturnValue({ type: "base-embed" }),
}));

import { registerJoinLeaveWatcher } from "../src/logWatcher/watchers/joinLeave.js";
import { registerChatBridge } from "../src/logWatcher/watchers/chatBridge.js";
import { registerDeathWatcher } from "../src/logWatcher/watchers/deaths.js";
import { registerServerEventWatcher } from "../src/logWatcher/watchers/serverEvents.js";
import { registerAdvancementWatcher } from "../src/logWatcher/watchers/advancements.js";
import type { ILogWatcher } from "../src/logWatcher/logWatcher.js";
import type { Client } from "discord.js";

// ── Mock ILogWatcher factory ───────────────────────────────────────────────

type HandlerFn = (match: RegExpExecArray, client: Client, server: unknown) => Promise<void>;

interface CapturedHandler {
  regex: RegExp;
  handler: HandlerFn;
}

function makeLogWatcher(serverId = "test"): ILogWatcher & { _handlers: CapturedHandler[] } {
  const handlers: CapturedHandler[] = [];
  return {
    server: { id: serverId } as ILogWatcher["server"],
    register: vi.fn((regex: RegExp, handler: HandlerFn) => {
      handlers.push({ regex, handler });
    }),
    _handlers: handlers,
  } as unknown as ILogWatcher & { _handlers: CapturedHandler[] };
}

function makeChannel() {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

function makeClient(channel: ReturnType<typeof makeChannel>) {
  return {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  } as unknown as Client;
}

const guildConfigsWithNotifs = {
  guild1: {
    notifications: { channelId: "ch1", events: ["join", "leave", "death", "start", "stop", "advancement"] },
    chatBridge: { channelId: "ch1" },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// JOIN / LEAVE WATCHER
// ══════════════════════════════════════════════════════════════════════════════

describe("joinLeave watcher — regex patterns", () => {
  // Access the registered regexes through the watcher
  it("registers exactly 2 handlers (join + leave)", () => {
    const watcher = makeLogWatcher();
    registerJoinLeaveWatcher(watcher, makeClient(makeChannel()), {});
    expect(watcher._handlers).toHaveLength(2);
  });

  it("JOIN regex matches standard join line", () => {
    const watcher = makeLogWatcher();
    registerJoinLeaveWatcher(watcher, makeClient(makeChannel()), {});
    const joinRegex = watcher._handlers[0]!.regex;
    const line = "[12:00:00] [Server thread/INFO]: Alice joined the game";
    const match = joinRegex.exec(line);
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Alice");
  });

  it("JOIN regex matches Bedrock player names prefixed with '.'", () => {
    const watcher = makeLogWatcher();
    registerJoinLeaveWatcher(watcher, makeClient(makeChannel()), {});
    const joinRegex = watcher._handlers[0]!.regex;
    const match = joinRegex.exec("[12:00:00] [Server thread/INFO]: .BedrockPlayer joined the game");
    expect(match).not.toBeNull();
    expect(match![1]).toBe(".BedrockPlayer");
  });

  it("LEAVE regex matches standard leave line", () => {
    const watcher = makeLogWatcher();
    registerJoinLeaveWatcher(watcher, makeClient(makeChannel()), {});
    const leaveRegex = watcher._handlers[1]!.regex;
    const match = leaveRegex.exec("[12:00:00] [Server thread/INFO]: Bob left the game");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Bob");
  });

  it("JOIN regex does NOT match a leave line", () => {
    const watcher = makeLogWatcher();
    registerJoinLeaveWatcher(watcher, makeClient(makeChannel()), {});
    const joinRegex = watcher._handlers[0]!.regex;
    expect(joinRegex.exec("[12:00:00]: Steve left the game")).toBeNull();
  });
});

describe("joinLeave watcher — handler invocation", () => {
  it("sends a Discord embed when a join matches and guild has join events enabled", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerJoinLeaveWatcher(watcher, client, guildConfigsWithNotifs);

    const joinRegex = watcher._handlers[0]!.regex;
    const line = "[12:00:00] [Server thread/INFO]: Steve joined the game";
    const match = joinRegex.exec(line)!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("does NOT send when guild has no notifications config", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerJoinLeaveWatcher(watcher, client, { guild1: {} });

    const joinRegex = watcher._handlers[0]!.regex;
    const match = joinRegex.exec("[12:00:00] [INFO]: Alice joined the game")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT BRIDGE WATCHER
// ══════════════════════════════════════════════════════════════════════════════

describe("chatBridge watcher — regex patterns", () => {
  it("registers exactly 1 handler", () => {
    const watcher = makeLogWatcher();
    registerChatBridge(watcher, makeClient(makeChannel()), {});
    expect(watcher._handlers).toHaveLength(1);
  });

  it("CHAT regex matches a standard chat message", () => {
    const watcher = makeLogWatcher();
    registerChatBridge(watcher, makeClient(makeChannel()), {});
    const chatRegex = watcher._handlers[0]!.regex;
    const match = chatRegex.exec("[12:00:00] [Server thread/INFO]: <Steve> Hello world");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Steve");
    expect(match![2]).toBe("Hello world");
  });

  it("CHAT regex matches message from AFK player", () => {
    const watcher = makeLogWatcher();
    registerChatBridge(watcher, makeClient(makeChannel()), {});
    const chatRegex = watcher._handlers[0]!.regex;
    const match = chatRegex.exec("[12:00:00] [Server thread/INFO]: <[AFK] Steve> Hi");
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Steve");
  });

  it("CHAT regex does NOT match a non-chat log line", () => {
    const watcher = makeLogWatcher();
    registerChatBridge(watcher, makeClient(makeChannel()), {});
    const chatRegex = watcher._handlers[0]!.regex;
    expect(chatRegex.exec("[12:00:00] [INFO]: Steve joined the game")).toBeNull();
  });
});

describe("chatBridge watcher — handler invocation", () => {
  it("sends the message to Discord when chatBridge is configured", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerChatBridge(watcher, client, guildConfigsWithNotifs);

    const chatRegex = watcher._handlers[0]!.regex;
    const match = chatRegex.exec("[12:00:00] [INFO]: <Steve> Hello world")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("does NOT forward in-game commands (messages starting with !)", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerChatBridge(watcher, client, guildConfigsWithNotifs);

    const chatRegex = watcher._handlers[0]!.regex;
    const match = chatRegex.exec("[12:00:00] [INFO]: <Steve> !coords")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).not.toHaveBeenCalled();
  });

  it("does NOT forward when guild has no chatBridge configured", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerChatBridge(watcher, client, { guild1: {} });

    const chatRegex = watcher._handlers[0]!.regex;
    const match = chatRegex.exec("[12:00:00] [INFO]: <Steve> Hello")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DEATH WATCHER
// ══════════════════════════════════════════════════════════════════════════════

describe("deaths watcher — regex patterns", () => {
  it("registers exactly 1 handler", () => {
    const watcher = makeLogWatcher();
    registerDeathWatcher(watcher, makeClient(makeChannel()), {});
    expect(watcher._handlers).toHaveLength(1);
  });

  const deathLines = [
    "[12:00:00] [INFO]: Steve was slain by Zombie",
    "[12:00:00] [INFO]: Alex was shot by Skeleton",
    "[12:00:00] [INFO]: Notch drowned",
    "[12:00:00] [INFO]: Herobrine fell from a high place",
    "[12:00:00] [INFO]: Player burned to death",
    "[12:00:00] [INFO]: PvpPro was killed by player",
    "[12:00:00] [INFO]: Miner hit the ground too hard",
    "[12:00:00] [INFO]: Explorer starved to death",
    "[12:00:00] [INFO]: Boss blew up",
    "[12:00:00] [INFO]: Diver suffocated in a wall",
  ];

  deathLines.forEach((line) => {
    it(`DEATH regex matches: "${line.slice(line.indexOf(": ") + 2)}"`, () => {
      const watcher = makeLogWatcher();
      registerDeathWatcher(watcher, makeClient(makeChannel()), {});
      const deathRegex = watcher._handlers[0]!.regex;
      expect(deathRegex.exec(line)).not.toBeNull();
    });
  });

  it("DEATH regex does NOT match a join line", () => {
    const watcher = makeLogWatcher();
    registerDeathWatcher(watcher, makeClient(makeChannel()), {});
    const deathRegex = watcher._handlers[0]!.regex;
    expect(deathRegex.exec("[12:00:00] [INFO]: Steve joined the game")).toBeNull();
  });
});

describe("deaths watcher — handler invocation", () => {
  it("sends a death embed when events include 'death'", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerDeathWatcher(watcher, client, guildConfigsWithNotifs);

    const deathRegex = watcher._handlers[0]!.regex;
    const match = deathRegex.exec("[12:00:00] [INFO]: Steve was slain by Zombie")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).toHaveBeenCalledOnce();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SERVER EVENT WATCHER
// ══════════════════════════════════════════════════════════════════════════════

describe("serverEvents watcher — regex patterns", () => {
  it("registers exactly 2 handlers (start + stop)", () => {
    const watcher = makeLogWatcher();
    registerServerEventWatcher(watcher, makeClient(makeChannel()), {});
    expect(watcher._handlers).toHaveLength(2);
  });

  it("START regex matches the server done line", () => {
    const watcher = makeLogWatcher();
    registerServerEventWatcher(watcher, makeClient(makeChannel()), {});
    const startRegex = watcher._handlers[0]!.regex;
    expect(
      startRegex.exec("[12:00:00] [Server thread/INFO]: Done (1.234s)!"),
    ).not.toBeNull();
  });

  it("STOP regex matches the stopping server line", () => {
    const watcher = makeLogWatcher();
    registerServerEventWatcher(watcher, makeClient(makeChannel()), {});
    const stopRegex = watcher._handlers[1]!.regex;
    expect(
      stopRegex.exec("[12:00:00] [Server thread/INFO]: Stopping server"),
    ).not.toBeNull();
  });

  it("START regex does NOT match a normal log line", () => {
    const watcher = makeLogWatcher();
    registerServerEventWatcher(watcher, makeClient(makeChannel()), {});
    expect(
      watcher._handlers[0]!.regex.exec("[12:00:00] [INFO]: Steve joined the game"),
    ).toBeNull();
  });
});

describe("serverEvents watcher — handler invocation", () => {
  it("sends a start embed when start event fires and guild has 'start' in events", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerServerEventWatcher(watcher, client, guildConfigsWithNotifs);

    const startRegex = watcher._handlers[0]!.regex;
    const match = startRegex.exec("[12:00:00] [INFO]: Done (1.0s)!")!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("sends a stop embed when stop fires and guild has 'stop' in events", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv2");
    registerServerEventWatcher(watcher, client, guildConfigsWithNotifs);

    // Fire start first so there is an uptime to compute
    const startRegex = watcher._handlers[0]!.regex;
    const startMatch = startRegex.exec("[12:00:00] [INFO]: Done (1.0s)!")!;
    await watcher._handlers[0]!.handler(startMatch, client, watcher.server);

    const stopRegex = watcher._handlers[1]!.regex;
    const stopMatch = stopRegex.exec("[12:00:01] [INFO]: Stopping server")!;
    await watcher._handlers[1]!.handler(stopMatch, client, watcher.server);

    expect(channel.send).toHaveBeenCalledTimes(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// ADVANCEMENT WATCHER
// ══════════════════════════════════════════════════════════════════════════════

describe("advancements watcher — regex patterns", () => {
  it("registers exactly 1 handler", () => {
    const watcher = makeLogWatcher();
    registerAdvancementWatcher(watcher, makeClient(makeChannel()), {});
    expect(watcher._handlers).toHaveLength(1);
  });

  it("ADV regex matches 'made the advancement'", () => {
    const watcher = makeLogWatcher();
    registerAdvancementWatcher(watcher, makeClient(makeChannel()), {});
    const advRegex = watcher._handlers[0]!.regex;
    const match = advRegex.exec(
      "[12:00:00] [INFO]: Steve has made the advancement [A Furious Cocktail]",
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Steve");
    expect(match![2]).toBe("A Furious Cocktail");
  });

  it("ADV regex matches 'completed the challenge'", () => {
    const watcher = makeLogWatcher();
    registerAdvancementWatcher(watcher, makeClient(makeChannel()), {});
    const advRegex = watcher._handlers[0]!.regex;
    const match = advRegex.exec(
      "[12:00:00] [INFO]: Alex has completed the challenge [How Did We Get Here?]",
    );
    expect(match).not.toBeNull();
    expect(match![1]).toBe("Alex");
    expect(match![2]).toBe("How Did We Get Here?");
  });

  it("ADV regex matches 'reached the goal'", () => {
    const watcher = makeLogWatcher();
    registerAdvancementWatcher(watcher, makeClient(makeChannel()), {});
    const advRegex = watcher._handlers[0]!.regex;
    expect(
      advRegex.exec("[12:00:00] [INFO]: Notch has reached the goal [Ice Bucket Challenge]"),
    ).not.toBeNull();
  });

  it("ADV regex does NOT match a chat message", () => {
    const watcher = makeLogWatcher();
    registerAdvancementWatcher(watcher, makeClient(makeChannel()), {});
    const advRegex = watcher._handlers[0]!.regex;
    expect(advRegex.exec("[12:00:00] [INFO]: <Steve> I got an advancement!")).toBeNull();
  });
});

describe("advancements watcher — handler invocation", () => {
  it("sends advancement embed when advancement event is enabled", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerAdvancementWatcher(watcher, client, guildConfigsWithNotifs);

    const advRegex = watcher._handlers[0]!.regex;
    const match = advRegex.exec(
      "[12:00:00] [INFO]: Steve has made the advancement [Stone Age]",
    )!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).toHaveBeenCalledOnce();
  });

  it("does NOT send when guild events do not include 'advancement'", async () => {
    const channel = makeChannel();
    const client = makeClient(channel);
    const watcher = makeLogWatcher("srv1");
    registerAdvancementWatcher(watcher, client, {
      guild1: { notifications: { channelId: "ch1", events: ["join"] } },
    });

    const advRegex = watcher._handlers[0]!.regex;
    const match = advRegex.exec(
      "[12:00:00] [INFO]: Steve has made the advancement [Stone Age]",
    )!;
    await watcher._handlers[0]!.handler(match, client, watcher.server);

    expect(channel.send).not.toHaveBeenCalled();
  });
});
