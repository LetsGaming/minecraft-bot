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
vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../src/core/utils/server.js", () => ({
  getAllInstances: () => [],
}));
vi.mock("../src/core/utils/i18n.js", () => ({
  runWithGuildLocale: <T>(_guildId: string | undefined, fn: () => T): T => fn(),
}));
vi.mock("../src/bot/utils/guildRouter.js", () => ({
  serverInScope: () => true,
}));

import type { Client } from "discord.js";
import { DEFAULT_NOTIFICATION_EVENTS } from "@mcbot/schema";
import { broadcastNotification } from "../src/bot/logWatcher/watchers/notifyGuilds.js";
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
