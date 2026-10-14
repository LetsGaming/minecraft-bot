/**
 * AUD-002 regression suite — speaker spoofing in player chat.
 *
 * The chat-driven watchers parsed `\[.+?\]: <name>` with no start anchor, so
 * text after the real speaker that looked like `x]: <Admin>` became the
 * speaker. These tests pin the anchored prefix (chatLine.ts) for each of the
 * three consumers: in-game `!commands`, the chat bridge and sleepWatcher.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/logWatcher/logWatcher.js", () => ({
  registerLogCommand: vi.fn(),
}));

import { registerLogCommand } from "../../src/bot/logWatcher/logWatcher.js";
import { defineCommand } from "../../src/bot/logWatcher/defineCommand.js";
import { registerChatBridge } from "../../src/bot/logWatcher/watchers/log/chatBridge.js";
import { registerSleepWatcher } from "../../src/bot/logWatcher/watchers/log/sleepWatcher.js";
import type { ILogWatcher } from "../../src/bot/logWatcher/logWatcher.js";
import type { Client } from "discord.js";

function capturingWatcher(): ILogWatcher & { regexes: RegExp[] } {
  const regexes: RegExp[] = [];
  return {
    server: { id: "t" } as ILogWatcher["server"],
    register(regex: RegExp) {
      regexes.push(regex);
    },
    async start() {},
    stop() {},
    regexes,
  } as unknown as ILogWatcher & { regexes: RegExp[] };
}

function commandRegex(name: string, args: string[]): RegExp {
  let captured: RegExp | undefined;
  vi.mocked(registerLogCommand).mockImplementationOnce((re) => {
    captured = re as RegExp;
  });
  defineCommand({ name, args, handler: async () => {} }).init();
  return captured!;
}

const LINK = commandRegex("link", ["code"]);
const VOTE = commandRegex("vote", ["choice"]);

const bridgeWatcher = capturingWatcher();
registerChatBridge(bridgeWatcher, {} as Client, {});
const [BRIDGE] = bridgeWatcher.regexes;

const sleepWatcher = capturingWatcher();
registerSleepWatcher(sleepWatcher);
const [SLEEP] = sleepWatcher.regexes;

const P = "[00:00:00] [Server thread/INFO]:";

describe("in-game commands", () => {
  it.each([
    // Plain chat with a forged second speaker.
    `${P} <Mallory> x]: <Admin> !link 123456`,
    // `/me`, which any player can use.
    `${P} * Mallory x]: <Admin> !link 123456`,
    // Discord text relayed through /say.
    `${P} [Server] [Bob] x]: <Admin> !link 123456`,
    `${P} [Server] [Bob] <Admin> !link 123456`,
    // Behind the 1.19+ unsigned-chat marker.
    `${P} [Not Secure] <Mallory> x]: <Admin> !link 123456`,
  ])("never takes the speaker from message text: %s", (line) => {
    const m = LINK.exec(line);
    expect(m).toBeNull();
  });

  it("still parses real commands in every supported log shape", () => {
    for (const line of [
      `${P} <Steve> !vote 2`,
      `${P} [Not Secure] <Steve> !vote 2`,
      `${P} <[AFK] Steve> !vote 2`,
      "[00:00:00 INFO]: <Steve> !vote 2",
      "[00:00:00] [Async Chat Thread - #0/INFO]: <Steve> !vote 2",
      "[00:00:00] [Server thread/INFO] [minecraft/MinecraftServer]: <Steve> !vote 2",
    ]) {
      const m = VOTE.exec(line);
      expect(m?.[1], line).toBe("Steve");
      expect(m?.[3], line).toBe("2");
    }
  });
});

describe("chat bridge", () => {
  it("relays the real speaker, with the forged part as message text", () => {
    const m = BRIDGE!.exec(`${P} [Not Secure] <Mallory> x]: <Admin> I resign`);
    expect(m?.[1]).toBe("Mallory");
    expect(m?.[2]).toBe("x]: <Admin> I resign");
  });

  it("ignores /me and /say lines", () => {
    expect(BRIDGE!.exec(`${P} * Mallory x]: <Admin> I resign`)).toBeNull();
    expect(BRIDGE!.exec(`${P} [Server] [Bob] <Admin> I resign`)).toBeNull();
  });
});

describe("sleepWatcher", () => {
  it("takes the speaker from the wrapper only", () => {
    expect(SLEEP!.exec(`${P} <Mallory> x]: <@a> liege wie`)?.[1]).toBe("Mallory");
    expect(SLEEP!.exec(`${P} <Steve> liege wie`)?.[1]).toBe("Steve");
  });
});
