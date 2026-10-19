/**
 * Regression coverage for BUG-05: notifications configured with only a
 * channel (what the setup wizard wrote) delivered nothing, because the
 * dispatcher skipped every event when `events` was unset and there was no
 * default.
 *
 * These tests exercise the REAL broadcastNotification filter (its
 * collaborators are stubbed) so the "absent events → default set" behavior,
 * the explicit-empty opt-out, and the default-set boundary are all pinned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the dispatcher's collaborators so only the events/channel filter is
// under test. serverInScope always passes here — scope has its own tests.
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: () => [],
}));
vi.mock("../../src/core/utils/i18n.js", () => ({
  runWithGuildLocale: <T>(_guildId: string | undefined, fn: () => T): T => fn(),
}));
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  serverInScope: () => true,
}));

import type { Client } from "discord.js";
import { DEFAULT_NOTIFICATION_EVENTS } from "@mcbot/schema";
import {
  broadcastNotification,
  sendToGuildChannels,
} from "../../src/bot/logWatcher/watchers/notifyGuilds.js";
import { roleMention } from "../../src/bot/utils/embeds/alertUtils.js";
import { log } from "../../src/core/utils/logger.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";

/** A Client whose channels.fetch always yields a channel with a spied send. */
function fakeClient(): { client: Client; send: ReturnType<typeof vi.fn> } {
  const send = vi.fn().mockResolvedValue(undefined);
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue({ send }) },
  } as unknown as Client;
  return { client, send };
}

async function deliver(
  guilds: Record<string, GuildConfig>,
  event: Parameters<typeof broadcastNotification>[2]["event"],
): Promise<number> {
  const { client, send } = fakeClient();
  await broadcastNotification(client, guilds, {
    serverId: "smp",
    event,
    buildEmbed: () => ({}) as never,
  });
  return send.mock.calls.length;
}

describe("broadcastNotification — events filter (BUG-05)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delivers a default event when a guild sets a channel but no events", async () => {
    // The exact wizard-written shape that used to be silently inert.
    const guilds = { g1: { notifications: { channelId: "c1" } } };
    expect(await deliver(guilds, "join")).toBe(1);
  });

  it("delivers every default event for a channel-only guild", async () => {
    const guilds = { g1: { notifications: { channelId: "c1" } } };
    for (const ev of DEFAULT_NOTIFICATION_EVENTS) {
      expect(await deliver(guilds, ev)).toBe(1);
    }
  });

  it("does NOT deliver opt-in extras (milestone) to a channel-only guild", async () => {
    // milestone/challenge/scheduledRestart are outside the default set — a
    // guild must ask for them explicitly, so the default stays quiet.
    expect(DEFAULT_NOTIFICATION_EVENTS).not.toContain("milestone");
    const guilds = { g1: { notifications: { channelId: "c1" } } };
    expect(await deliver(guilds, "milestone")).toBe(0);
  });

  it("honors an explicit events list (selected in, others out)", async () => {
    const guilds = { g1: { notifications: { channelId: "c1", events: ["join"] } } };
    expect(await deliver(guilds, "join")).toBe(1);
    expect(await deliver(guilds, "death")).toBe(0);
  });

  it("delivers an explicitly-requested extra event", async () => {
    const guilds = {
      g1: { notifications: { channelId: "c1", events: ["milestone"] } },
    };
    expect(await deliver(guilds, "milestone")).toBe(1);
  });

  it("treats an explicit empty events list as a deliberate opt-out", async () => {
    const guilds = { g1: { notifications: { channelId: "c1", events: [] } } };
    expect(await deliver(guilds, "join")).toBe(0);
  });

  it("delivers nothing when no channel is configured", async () => {
    const guilds = { g1: { notifications: { events: ["join"] } } };
    expect(await deliver(guilds, "join")).toBe(0);
  });
});

describe("sendToGuildChannels", () => {
  beforeEach(() => vi.clearAllMocks());

  const alertGuilds = {
    g1: { downtimeAlerts: { channelId: "c1", mentionRole: "role-1" } },
    g2: { downtimeAlerts: {} },
    g3: {},
  } as Record<string, GuildConfig>;

  it("sends to each guild with a channel, building per guild and pinging the guild's role", async () => {
    const { client, send } = fakeClient();
    const build = vi.fn(() => ({ embeds: [{} as never] }));
    await sendToGuildChannels(client, alertGuilds, {
      pick: (gcfg) => gcfg.downtimeAlerts,
      serverId: "smp",
      logTag: "test",
      build,
      mention: (target) => roleMention(target.mentionRole),
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0]).toMatchObject({
      content: "<@&role-1>",
      allowedMentions: { parse: [], roles: ["role-1"] },
    });
  });

  it("is silent when no mention is supplied", async () => {
    const { client, send } = fakeClient();
    await sendToGuildChannels(client, alertGuilds, {
      pick: (gcfg) => gcfg.downtimeAlerts,
      serverId: "smp",
      logTag: "test",
      build: () => ({ content: "hi" }),
    });
    expect(send.mock.calls[0]![0]).toEqual({ content: "hi", allowedMentions: { parse: [] } });
  });

  it("skips a channel that cannot take messages and logs a failing send without throwing", async () => {
    const client = {
      channels: { fetch: vi.fn().mockResolvedValue({ name: "voice" }) },
    } as unknown as Client;
    await expect(
      sendToGuildChannels(client, alertGuilds, {
        pick: (gcfg) => gcfg.downtimeAlerts,
        serverId: "smp",
        logTag: "test",
        build: () => ({ content: "x" }),
      }),
    ).resolves.toBeUndefined();

    const failing = {
      channels: {
        fetch: vi.fn().mockResolvedValue({ send: vi.fn().mockRejectedValue(new Error("403")) }),
      },
    } as unknown as Client;
    await sendToGuildChannels(failing, alertGuilds, {
      pick: (gcfg) => gcfg.downtimeAlerts,
      serverId: "smp",
      logTag: "test",
      build: () => ({ content: "x" }),
    });
    expect(log.error).toHaveBeenCalledWith("test", expect.stringContaining("403"));
  });
});
