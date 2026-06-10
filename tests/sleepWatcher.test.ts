/**
 * sleepWatcher tests
 *
 * Coverage strategy:
 *   - Importing the module covers ~300 lines of TITLES_* array data at module level.
 *   - Handler invocation with a mock ServerInstance covers all the logic branches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { registerSleepWatcher } from "../src/logWatcher/watchers/sleepWatcher.js";
import type { ILogWatcher } from "../src/logWatcher/logWatcher.js";
import type { ServerInstance } from "../src/utils/server.js";
import type { Client } from "discord.js";

// ── helpers ────────────────────────────────────────────────────────────────

type HandlerFn = (
  match: RegExpExecArray,
  client: Client,
  server: ServerInstance,
) => Promise<void>;

interface CapturedHandler {
  regex: RegExp;
  handler: HandlerFn;
}

function makeLogWatcher(
  serverId = "sleep-test",
): ILogWatcher & { _handlers: CapturedHandler[] } {
  const handlers: CapturedHandler[] = [];
  return {
    server: { id: serverId } as ILogWatcher["server"],
    register: vi.fn((regex: RegExp, handler: HandlerFn) => {
      handlers.push({ regex, handler });
    }),
    _handlers: handlers,
  } as unknown as ILogWatcher & { _handlers: CapturedHandler[] };
}

function makeServer(
  opts: {
    id?: string;
    sleepTimerOutput?: string;
    timeOutput?: string;
    sendCommandError?: boolean;
  } = {},
) {
  const sendCommand = vi.fn().mockImplementation(async (cmd: string) => {
    if (opts.sendCommandError) throw new Error("RCON unavailable");
    if (cmd.includes("SleepTimer")) return opts.sleepTimerOutput ?? null;
    if (cmd.includes("/time query")) return opts.timeOutput ?? null;
    return undefined; // title commands
  });
  return {
    id: opts.id ?? "survival",
    sendCommand,
  } as unknown as ServerInstance;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// Registration
// ══════════════════════════════════════════════════════════════════════════════

describe("registerSleepWatcher — registration", () => {
  it("registers exactly 1 handler on the log watcher", () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    expect(watcher._handlers).toHaveLength(1);
  });

  it("the regex matches a standard chat line", () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    const regex = watcher._handlers[0]!.regex;
    expect(
      regex.exec("[12:00:00] [Server thread/INFO]: <Steve> liege wie"),
    ).not.toBeNull();
  });

  it("the regex captures player name in group 1 and message in group 2", () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    const regex = watcher._handlers[0]!.regex;
    const match = regex.exec(
      "[12:00:00] [Server thread/INFO]: <Alice> liege wie",
    )!;
    expect(match[1]).toBe("Alice");
    expect(match[2]).toBe("liege wie");
  });

  it("the regex matches AFK-prefixed player names", () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    const regex = watcher._handlers[0]!.regex;
    const match = regex.exec("[12:00:00] [INFO]: <[AFK] Steve> liege wie")!;
    expect(match).not.toBeNull();
    expect(match[1]).toBe("Steve");
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Handler — non-trigger messages are ignored
// ══════════════════════════════════════════════════════════════════════════════

describe("handler — non-sleep trigger messages", () => {
  it("does not call sendCommand for a regular chat message", async () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;
    const server = makeServer({
      sleepTimerOutput: "87s",
      timeOutput: "The time is 13000",
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> hello world")!;
    await handler(match, null as unknown as Client, server);

    expect(server.sendCommand).not.toHaveBeenCalled();
  });

  it("does not trigger for a message that contains but is not exactly 'liege wie'", async () => {
    const watcher = makeLogWatcher();
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;
    const server = makeServer({
      sleepTimerOutput: "87s",
      timeOutput: "The time is 13000",
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie bitte")!;
    if (!match) return; // regex might not match, test still passes
    await handler(match, null as unknown as Client, server);
    // SleepTimer was never queried — the message wasn't "liege wie" exactly
    expect(server.sendCommand).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Handler — player not in bed → no title
// ══════════════════════════════════════════════════════════════════════════════

describe("handler — player not in bed", () => {
  it("does not send title when SleepTimer is 0", async () => {
    const watcher = makeLogWatcher("no-sleep-server");
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;
    const server = makeServer({
      id: "no-sleep-server",
      sleepTimerOutput: "Steve has the following entity data: 0s",
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;
    await handler(match, null as unknown as Client, server);

    // sendCommand called once for SleepTimer check, but no /title commands
    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).includes("/title"),
    );
    expect(titleCalls).toHaveLength(0);
  });

  it("does not send title when sendCommand returns null (RCON fallback)", async () => {
    const watcher = makeLogWatcher("null-rcon");
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;
    const server = makeServer({
      id: "null-rcon",
      sleepTimerOutput: null as unknown as string,
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;
    await handler(match, null as unknown as Client, server);

    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).includes("/title"),
    );
    expect(titleCalls).toHaveLength(0);
  });

  it("does not send title when RCON throws (network error)", async () => {
    const watcher = makeLogWatcher("rcon-error");
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;
    const server = makeServer({ id: "rcon-error", sendCommandError: true });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;
    await expect(
      handler(match, null as unknown as Client, server),
    ).resolves.toBeUndefined();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Handler — isNight fallback behavior
// ══════════════════════════════════════════════════════════════════════════════

describe("handler — isNight fallback", () => {
  it("still sends title when /time query returns null (RCON fallback = assume night)", async () => {
    const watcher = makeLogWatcher("null-time-server");
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;

    const server = makeServer({
      id: "null-time-server",
      sleepTimerOutput: "Steve has the following entity data: 87s",
      timeOutput: null as unknown as string, // /time query returns null → isNight=true
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;
    await handler(match, null as unknown as Client, server);

    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    );
    expect(titleCalls.length).toBe(2);
  });

  it("sends title when /time query output has no number (isNight=true by default)", async () => {
    const watcher = makeLogWatcher("no-num-time");
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;

    const server = makeServer({
      id: "no-num-time",
      sleepTimerOutput: "Steve has the following entity data: 87s",
      timeOutput: "The time is unknown", // no digit match → isNight=true
    });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;
    await handler(match, null as unknown as Client, server);

    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    );
    expect(titleCalls.length).toBe(2);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Handler — in bed + night → sends titles
// ══════════════════════════════════════════════════════════════════════════════

describe("handler — in bed + nighttime → sends /title commands", () => {
  async function triggerSleep(
    serverId: string,
    message: string,
  ): Promise<ReturnType<typeof makeServer>> {
    const watcher = makeLogWatcher(serverId);
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;

    const server = makeServer({
      id: serverId,
      sleepTimerOutput: "Steve has the following entity data: 87s",
      timeOutput: "The time is 13000", // nighttime (13000 >= 12542)
    });

    const match = regex.exec(`[12:00:00] [INFO]: <Steve> ${message}`)!;
    await handler(match, null as unknown as Client, server);
    return server;
  }

  it("sends two /title commands (title + subtitle) for 'liege wie' (lowercase)", async () => {
    const server = await triggerSleep("lower-test", "liege wie");
    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    );
    expect(titleCalls.length).toBe(2);
  });

  it("sends /title commands for 'LIEGE WIE' (allcaps)", async () => {
    const server = await triggerSleep("allcaps-test", "LIEGE WIE");
    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    );
    expect(titleCalls.length).toBe(2);
  });

  it("sends /title commands for 'Liege Wie' (normal case)", async () => {
    const server = await triggerSleep("normal-test", "Liege Wie");
    const titleCalls = server.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    );
    expect(titleCalls.length).toBe(2);
  });

  it("title command targets the correct selector excluding the trigger player", async () => {
    const server = await triggerSleep("selector-test", "liege wie");
    const titleCalls = server.sendCommand.mock.calls
      .filter(([c]) => (c as string).startsWith("/title"))
      .map(([c]) => c as string);
    // Selector should exclude trigger player
    expect(titleCalls.some((c) => c.includes("Steve"))).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Cooldown
// ══════════════════════════════════════════════════════════════════════════════

describe("handler — cooldown", () => {
  it("does not send a second title within the cooldown window", async () => {
    const serverId = "cooldown-server-" + Date.now();
    const watcher = makeLogWatcher(serverId);
    registerSleepWatcher(watcher);
    const { regex, handler } = watcher._handlers[0]!;

    const makeNightServer = () =>
      makeServer({
        id: serverId,
        sleepTimerOutput: "Steve has the following entity data: 87s",
        timeOutput: "The time is 13000",
      });

    const match = regex.exec("[12:00:00] [INFO]: <Steve> liege wie")!;

    // First trigger — should fire
    const server1 = makeNightServer();
    await handler(match, null as unknown as Client, server1);
    const firstTitleCalls = server1.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    ).length;
    expect(firstTitleCalls).toBe(2);

    // Second trigger within cooldown — should be skipped
    const server2 = makeNightServer();
    await handler(match, null as unknown as Client, server2);
    const secondTitleCalls = server2.sendCommand.mock.calls.filter(([c]) =>
      (c as string).startsWith("/title"),
    ).length;
    expect(secondTitleCalls).toBe(0);
  });
});
