/**
 * Regression coverage: guild config was a STARTUP SNAPSHOT.
 *
 * Watchers, monitors and schedulers are wired exactly once and then run for
 * the process lifetime, and `reconcileServers` only reconciles the `servers`
 * block. Passing `cfg.guilds` in by value therefore froze the guild set at
 * boot: a guild added afterwards (dashboard write, hand edit, /config
 * reload) never reached any handler, so its chatBridge and notifications
 * stayed dead until a full process restart. With two guilds sharing one
 * server that reads as "the bridge only works for one of my guilds".
 *
 * These tests pin the provider contract that replaced the snapshot: every
 * consumer resolves its guild configs at EVENT time, so a guild that
 * appears after wiring is served on the very next event.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createPlayerEmbed: vi.fn().mockReturnValue({ type: "player-embed" }),
  createEmbed: vi.fn().mockReturnValue({ type: "embed" }),
}));
vi.mock("../../src/bot/utils/mcHeads.js", () => ({
  playerAvatarUrl: () => "https://example.invalid/head.png",
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: () => [],
}));
vi.mock("../../src/core/utils/i18n.js", () => ({
  t: (key: string) => key,
  runWithGuildLocale: <T>(_guildId: string | undefined, fn: () => T): T => fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: () => true,
}));

import type { Client } from "discord.js";
import type { GuildConfig } from "../../src/core/types/index.js";
import type { ILogWatcher } from "../../src/bot/logWatcher/logWatcher.js";
import { registerChatBridge } from "../../src/bot/logWatcher/watchers/log/chatBridge.js";
import { broadcastNotification } from "../../src/bot/logWatcher/watchers/notifyGuilds.js";

type GuildConfigs = Record<string, GuildConfig>;

/** The guild block "on disk" — mutated between wiring and the event. */
let onDisk: GuildConfigs;
const liveConfigs = (): GuildConfigs => onDisk;

const guildA: GuildConfigs = {
  guildA: {
    defaultServer: "smp",
    chatBridge: { channelId: "chan-a", server: "smp" },
    notifications: { channelId: "notif-a" },
  },
};

/** guildA plus a second guild bound to the SAME server. */
const guildAB: GuildConfigs = {
  ...guildA,
  guildB: {
    defaultServer: "smp",
    chatBridge: { channelId: "chan-b", server: "smp" },
    notifications: { channelId: "notif-b" },
  },
};

/** A Client recording which channel IDs were sent to. */
function fakeClient(): { client: Client; sentTo: string[] } {
  const sentTo: string[] = [];
  const client = {
    channels: {
      fetch: vi.fn(async (id: string) => ({
        send: vi.fn(async () => {
          sentTo.push(id);
        }),
      })),
    },
  } as unknown as Client;
  return { client, sentTo };
}

/** A watcher that captures the registered handler so we can fire log lines. */
function fakeWatcher(): {
  watcher: ILogWatcher;
  emit: (line: string) => Promise<void>;
} {
  const handlers: Array<{
    regex: RegExp;
    handler: (m: RegExpMatchArray) => Promise<void> | void;
  }> = [];
  const watcher = {
    server: { id: "smp" },
    register: (
      regex: RegExp,
      handler: (m: RegExpMatchArray) => Promise<void> | void,
    ) => {
      handlers.push({ regex, handler });
    },
  } as unknown as ILogWatcher;

  return {
    watcher,
    emit: async (line: string) => {
      for (const { regex, handler } of handlers) {
        const match = line.match(regex);
        if (match) await handler(match);
      }
    },
  };
}

const CHAT_LINE = "[12:00:00] [Server thread/INFO]: <Steve> hello everyone";

describe("guild config is resolved live, not snapshotted at wiring time", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    onDisk = guildA;
  });

  it("bridges chat to a guild added AFTER the watcher was wired", async () => {
    const { client, sentTo } = fakeClient();
    const { watcher, emit } = fakeWatcher();

    // Wired while only guildA exists — the snapshot bug froze it here.
    registerChatBridge(watcher, client, liveConfigs, ["smp"]);

    await emit(CHAT_LINE);
    expect(sentTo).toEqual(["chan-a"]);

    // Operator adds a second guild on the same server and reloads.
    onDisk = guildAB;
    sentTo.length = 0;

    await emit(CHAT_LINE);
    expect(sentTo).toEqual(["chan-a", "chan-b"]);
  });

  it("stops bridging to a guild removed from the config", async () => {
    onDisk = guildAB;
    const { client, sentTo } = fakeClient();
    const { watcher, emit } = fakeWatcher();

    registerChatBridge(watcher, client, liveConfigs, ["smp"]);
    await emit(CHAT_LINE);
    expect(sentTo).toEqual(["chan-a", "chan-b"]);

    // Live resolution has to cut both ways: a removal applies too.
    onDisk = guildA;
    sentTo.length = 0;

    await emit(CHAT_LINE);
    expect(sentTo).toEqual(["chan-a"]);
  });

  it("notifies a guild added after the dispatcher's caller was wired", async () => {
    const { client, sentTo } = fakeClient();

    await broadcastNotification(client, liveConfigs, {
      serverId: "smp",
      event: "join",
      buildEmbed: () => ({}) as never,
    });
    expect(sentTo).toEqual(["notif-a"]);

    onDisk = guildAB;
    sentTo.length = 0;

    await broadcastNotification(client, liveConfigs, {
      serverId: "smp",
      event: "join",
      buildEmbed: () => ({}) as never,
    });
    expect(sentTo).toEqual(["notif-a", "notif-b"]);
  });

  it("still accepts a fixed record (the snapshot stays available)", async () => {
    const { client, sentTo } = fakeClient();
    const { watcher, emit } = fakeWatcher();

    registerChatBridge(watcher, client, guildA, ["smp"]);
    onDisk = guildAB; // irrelevant: this caller asked for a fixed set

    await emit(CHAT_LINE);
    expect(sentTo).toEqual(["chan-a"]);
  });
});
