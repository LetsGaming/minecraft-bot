/**
 * SEC-01 regression suite — chat-forgeable server events.
 *
 * The audit's PoC: the old `\[.+?\].*:` prefix let a *chat* message
 * match the advancement/death/join/leave/start/stop watchers, because
 * `.*:` consumed the `<name>` wrapper up to any embedded colon. A forged
 * advancement matching the active challenge paid out a real item bonus.
 *
 * These tests pin both layers of the fix:
 *  1. The watcher regexes anchor on the server thread tag and must
 *     reject every PoC line while still matching legitimate vanilla,
 *     Forge-tagged, and Bedrock-name lines.
 *  2. registerServerEvent()'s chat-wrapper backstop must drop a
 *     chat-shaped line even if a (hypothetically loosened) regex matched.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: vi.fn().mockReturnValue(true),
  getAllowedServerIds: vi.fn().mockReturnValue(null),
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
  createEmbed: vi.fn().mockReturnValue({ type: "base-embed" }),
}));

import {
  isChatWrapped,
  registerServerEvent,
  serverEventRegex,
} from "../../src/bot/logWatcher/watchers/log/serverLine.js";
import { registerAdvancementWatcher } from "../../src/bot/logWatcher/watchers/log/advancements.js";
import { registerDeathWatcher } from "../../src/bot/logWatcher/watchers/log/deaths.js";
import { registerJoinLeaveWatcher } from "../../src/bot/logWatcher/watchers/log/joinLeave.js";
import { registerServerEventWatcher } from "../../src/bot/logWatcher/watchers/log/serverEvents.js";
import type { ILogWatcher } from "../../src/bot/logWatcher/logWatcher.js";
import type { Client } from "discord.js";

type HandlerFn = (
  match: RegExpExecArray,
  client: Client,
  server: unknown,
) => Promise<void>;

function makeLogWatcher(
  serverId = "test",
): ILogWatcher & { _handlers: Array<{ regex: RegExp; handler: HandlerFn }> } {
  const handlers: Array<{ regex: RegExp; handler: HandlerFn }> = [];
  return {
    server: { id: serverId } as ILogWatcher["server"],
    register(regex: RegExp, handler) {
      handlers.push({ regex, handler: handler as HandlerFn });
    },
    async start() {},
    stop() {},
    _handlers: handlers,
  };
}

const client = {} as Client;

function regexesOf(register: (w: ILogWatcher, c: Client, g: never) => void) {
  const watcher = makeLogWatcher();
  register(watcher, client, {} as never);
  return watcher._handlers.map((h) => h.regex);
}

const [ADV] = regexesOf(registerAdvancementWatcher);
const [DEATH] = regexesOf(registerDeathWatcher);
const [JOIN, LEAVE] = regexesOf(registerJoinLeaveWatcher);
const [START, STOP] = regexesOf(registerServerEventWatcher);

// ── Audit PoC lines (must never match anything) ────────────────────────────

const CHAT_FORGERIES = [
  // The exact PoC shapes from the audit (Paper async chat thread):
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Victim has made the advancement [Hax]",
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Victim died lol",
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Victim joined the game",
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Victim left the game",
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Done (5.0s)!",
  "[00:00:00] [Async Chat Thread - #0/INFO]: <Mallory> x: Stopping server",
  // Vanilla logs chat on the Server thread itself — the anchor alone
  // must not be the only defense:
  "[00:00:00] [Server thread/INFO]: <Mallory> x: Victim has made the advancement [Hax]",
  "[00:00:00] [Server thread/INFO]: <Mallory> Victim joined the game",
  "[00:00:00] [Server thread/INFO]: <Mallory> x: Victim was slain by lies",
  // 1.19+ unsigned-chat marker:
  "[00:00:00] [Server thread/INFO]: [Not Secure] <Mallory> x: Victim has made the advancement [Hax]",
  // AFK-prefixed chat wrapper:
  "[00:00:00] [Server thread/INFO]: <[AFK] Mallory> x: Victim died",
  // Player /say output ([name] payload on the Server thread):
  "[00:00:00] [Server thread/INFO]: [Mallory] x: Victim has made the advancement [Hax]",
];

describe("SEC-01 — chat lines cannot forge server events", () => {
  it.each(CHAT_FORGERIES)("no watcher matches: %s", (line) => {
    for (const regex of [ADV, DEATH, JOIN, LEAVE, START, STOP]) {
      expect(regex!.exec(line)).toBeNull();
    }
  });
});

// ── Legitimate server lines must keep matching ─────────────────────────────

describe("SEC-01 — legitimate server lines still match", () => {
  it("vanilla advancement / challenge / goal", () => {
    expect(
      ADV!.exec(
        "[12:00:00] [Server thread/INFO]: Steve has made the advancement [Stone Age]",
      )?.slice(1, 3),
    ).toEqual(["Steve", "Stone Age"]);
    expect(
      ADV!.exec(
        "[12:00:00] [Server thread/INFO]: Alex has completed the challenge [How Did We Get Here?]",
      ),
    ).not.toBeNull();
    expect(
      ADV!.exec(
        "[12:00:00] [Server thread/INFO]: Notch has reached the goal [Ice Bucket Challenge]",
      ),
    ).not.toBeNull();
  });

  it("Forge-style extra tag after the thread tag", () => {
    const m = JOIN!.exec(
      "[12:34:56] [Server thread/INFO] [minecraft/MinecraftServer]: Steve joined the game",
    );
    expect(m?.[1]).toBe("Steve");
  });

  it("Bedrock '.'-prefixed names (join, death, advancement)", () => {
    expect(
      JOIN!.exec(
        "[12:00:00] [Server thread/INFO]: .BedrockPlayer joined the game",
      )?.[1],
    ).toBe(".BedrockPlayer");
    expect(
      DEATH!.exec(
        "[12:00:00] [Server thread/INFO]: .BedrockPlayer was slain by Zombie",
      )?.[1],
    ).toBe(".BedrockPlayer");
    expect(
      ADV!.exec(
        "[12:00:00] [Server thread/INFO]: .BedrockPlayer has made the advancement [Stone Age]",
      )?.[1],
    ).toBe(".BedrockPlayer");
  });

  it("death, leave, start, stop", () => {
    expect(
      DEATH!.exec("[12:00:00] [Server thread/INFO]: Steve was slain by Zombie"),
    ).not.toBeNull();
    expect(
      LEAVE!.exec("[12:00:00] [Server thread/INFO]: Bob left the game")?.[1],
    ).toBe("Bob");
    expect(
      START!.exec("[12:00:00] [Server thread/INFO]: Done (12.345s)!"),
    ).not.toBeNull();
    expect(
      STOP!.exec("[12:00:00] [Server thread/INFO]: Stopping server"),
    ).not.toBeNull();
  });
});

// ── The chat-wrapper backstop itself ───────────────────────────────────────

describe("SEC-01 — isChatWrapped / registerServerEvent backstop", () => {
  it("flags chat-shaped message segments", () => {
    expect(
      isChatWrapped("[00:00:00] [Server thread/INFO]: <Mallory> hi"),
    ).toBe(true);
    expect(
      isChatWrapped("[00:00:00] [Server thread/INFO]: [Not Secure] <Mallory> hi"),
    ).toBe(true);
    expect(
      isChatWrapped("[00:00:00] [Server thread/INFO]: <[AFK] Mallory> hi"),
    ).toBe(true);
  });

  it("passes genuine event lines", () => {
    expect(
      isChatWrapped("[12:00:00] [Server thread/INFO]: Steve joined the game"),
    ).toBe(false);
    expect(
      isChatWrapped(
        "[12:00:00] [Server thread/INFO]: Steve has made the advancement [Stone Age]",
      ),
    ).toBe(false);
  });

  it("drops a chat line even when a loosened regex matches it", async () => {
    // Simulate a future regression: a watcher regex that is loose enough
    // to match a chat line again. The dispatch guard must still drop it.
    const watcher = makeLogWatcher();
    const handler = vi.fn().mockResolvedValue(undefined);
    const loose = /(\w+) joined the game/;
    registerServerEvent(watcher, loose, handler);

    const chatLine =
      "[00:00:00] [Server thread/INFO]: <Mallory> Victim joined the game";
    const chatMatch = loose.exec(chatLine)!;
    expect(chatMatch).not.toBeNull(); // the loose regex DOES match…
    await watcher._handlers[0]!.handler(chatMatch, client, watcher.server);
    expect(handler).not.toHaveBeenCalled(); // …but the guard drops it

    const serverLine = "[00:00:00] [Server thread/INFO]: Victim joined the game";
    const okMatch = loose.exec(serverLine)!;
    await watcher._handlers[0]!.handler(okMatch, client, watcher.server);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("serverEventRegex anchors at line start", () => {
    const re = serverEventRegex(String.raw`Done \([\d.]+s\)!`);
    // Prefix must be at position 0 — a chat message *containing* a
    // fabricated prefix can't smuggle one in mid-line.
    expect(
      re.exec(
        "[00:00:00] [Async Chat Thread - #0/INFO]: <M> [x] [Server thread/INFO]: Done (1.0s)!",
      ),
    ).toBeNull();
  });
});
