/**
 * Feature plumbing: validation of the new config blocks, the
 * LastDeathLocation NBT parser on ServerInstance, and the advancement →
 * challenge win path (state transition + announcements + bonus queueing).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateCandidateConfig } from "../../src/core/config.js";

const base = {
  token: "t",
  clientId: "c",
  servers: {
    smp: {
      screenSession: "smp",
      serverDir: "/srv/mc/smp",
      linuxUser: "mc-smp",
      logFile: "logs/latest.log",
    },
  },
  guilds: { g1: {} },
};

describe("validateCandidateConfig — new feature blocks", () => {
  it("accepts a full valid configuration", () => {
    const result = validateCandidateConfig({
      ...base,
      presence: { enabled: true, server: "smp", format: "{online} on" },
      deathCoords: { dmLinked: true },
      hostAlerts: { diskWarnPercent: 85 },
      guilds: {
        g1: {
          linkedRole: "123456789012345678",
          reports: {
            channelId: "234567890123456789",
            mentionRole: "345678901234567890",
            server: "smp",
          },
        },
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects wrong types with pointed messages", () => {
    const result = validateCandidateConfig({
      ...base,
      presence: { enabled: "yes" },
      deathCoords: { dmLinked: 1 },
      hostAlerts: { diskWarnPercent: 150 },
      guilds: {
        g1: { linkedRole: 42, reports: { channelId: 7 } },
      },
    });
    expect(result.valid).toBe(false);
    const all = result.errors.join("\n");
    expect(all).toContain("presence.enabled");
    expect(all).toContain("deathCoords.dmLinked");
    expect(all).toContain("hostAlerts.diskWarnPercent");
    expect(all).toContain("guilds.g1.linkedRole");
    expect(all).toContain("guilds.g1.reports.channelId");
  });

  it("warns (not errors) on suspicious values", () => {
    const result = validateCandidateConfig({
      ...base,
      presence: { enabled: true, server: "ghost" },
      guilds: { g1: { linkedRole: "not-a-snowflake" } },
    });
    expect(result.valid).toBe(true);
    const warnings = result.warnings.join("\n");
    expect(warnings).toContain('unknown server "ghost"');
    expect(warnings).toContain("does not look");
  });

  it("warns when reports.server references an unknown server (scope-ref convention)", () => {
    const result = validateCandidateConfig({
      ...base,
      guilds: { g1: { reports: { channelId: "1", server: "nope" } } },
    });
    // Unknown scope refs are warnings across all features (defaultServer,
    // chatBridge, notifications, …) — reports follows the same convention.
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain("reports.server");
  });
});

// ── getLastDeathLocation parsing ────────────────────────────────────────────

describe("ServerInstance.getLastDeathLocation", () => {
  it("parses the RCON NBT response including the dimension", async () => {
    const { ServerInstance } = await import("../../src/core/utils/server/server.js");
    const server = new ServerInstance("smp", {
      screenSession: "smp",
      serverDir: "/srv",
      linuxUser: "mc",
      logFile: "l",
      useRcon: true,
    } as never);
    vi.spyOn(server, "getPlayerData").mockResolvedValue(
      'Alice has the following entity data: {pos: [I; -180, 63, 254], dimension: "minecraft:the_nether"}',
    );

    expect(await server.getLastDeathLocation("Alice")).toEqual({
      x: -180,
      y: 63,
      z: 254,
      dimension: "the_nether",
    });
  });

  it("returns null when the tag is missing (never died)", async () => {
    const { ServerInstance } = await import("../../src/core/utils/server/server.js");
    const server = new ServerInstance("smp", {
      screenSession: "smp",
      serverDir: "/srv",
      linuxUser: "mc",
      logFile: "l",
      useRcon: true,
    } as never);
    vi.spyOn(server, "getPlayerData").mockResolvedValue(
      "Found no elements matching LastDeathLocation",
    );
    expect(await server.getLastDeathLocation("Alice")).toBeNull();
  });
});

// ── advancement → challenge win path ────────────────────────────────────────

describe("advancement watcher — challenge win", () => {
  beforeEach(() => vi.resetModules());

  async function setup(storeData: unknown) {
    vi.doMock("../../src/core/utils/paths.js", () => ({
      getRootDir: vi.fn().mockReturnValue("/tmp"),
    }));
    vi.doMock("../../src/core/utils/jsonStore.js", () => ({
      loadJson: vi.fn().mockResolvedValue({}),
      saveJson: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/core/config.js", () => ({
      loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
      getServerIds: vi.fn().mockReturnValue(["smp"]),
    }));
    vi.doMock("../../src/core/utils/stores/adminAudit.js", () => ({
      recordAdminAction: vi.fn().mockResolvedValue(undefined),
    }));
    const broadcastNotification = vi.fn().mockResolvedValue(undefined);
    vi.doMock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
      broadcastNotification,
      PLAYER_NAME: String.raw`\.?[a-zA-Z0-9_]{1,32}`,
    }));

    // vi.resetModules() gives the watcher a fresh db module — seed and
    // read through that registry, not the file-scope one.
    const { closeDbForTesting } = await import("../../src/core/db/index.js");
    const { kvGet, kvSet } = await import("../../src/core/db/kv.js");
    closeDbForTesting();
    kvSet("challenges", storeData);

    const { registerAdvancementWatcher } = await import(
      "../../src/bot/logWatcher/watchers/log/advancements.js"
    );
    const { recordAdminAction } = await import("../../src/core/utils/stores/adminAudit.js");
    const { saveJson } = await import("../../src/core/utils/jsonStore.js");

    let handler!: (m: RegExpExecArray) => Promise<void>;
    let regex!: RegExp;
    const logWatcher = {
      server: {
        id: "smp",
        config: { useRcon: true },
        sendCommand: vi.fn().mockResolvedValue("Gave 1 [Diamond] to Alice"),
      },
      register: (re: RegExp, fn: never) => {
        regex = re;
        handler = fn;
      },
    };
    registerAdvancementWatcher(logWatcher as never, {} as never, {});
    return {
      run: (line: string) => handler(regex.exec(line)!),
      server: logWatcher.server,
      broadcastNotification,
      recordAdminAction: vi.mocked(recordAdminAction),
      saveJson: vi.mocked(saveJson),
      kvGet,
    };
  }

  const line = (player: string, adv: string) =>
    `[12:00:00] [Server thread/INFO]: ${player} has made the advancement [${adv}]`;

  it("first matching advancement wins the active challenge", async () => {
    const store = {
      version: 1,
      servers: {
        smp: [
          {
            advancement: "Stone Age",
            item: "diamond",
            startedBy: "A#1",
            startedById: "1",
            startedAt: 1,
            status: "active",
          },
        ],
      },
    };
    const ctx = await setup(store);
    await ctx.run(line("Alice", "stone age")); // case-insensitive

    const after = ctx.kvGet("challenges") as {
      servers: Record<string, Array<Record<string, unknown>>>;
    };
    const challenge = after.servers["smp"]![0]!;
    expect(challenge["status"]).toBe("won");
    expect(challenge["wonBy"]).toBe("Alice");
    // Advancement embed + challenge-won embed both broadcast.
    expect(ctx.broadcastNotification).toHaveBeenCalledTimes(2);
    expect(ctx.recordAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "challenge won", by: "Alice" }),
    );
    // Winner announcement + confirmed item give happened.
    const cmds = ctx.server.sendCommand.mock.calls.map(([c]: [string]) => c);
    expect(cmds.some((c) => c.startsWith("/tellraw @a"))).toBe(true);
    expect(cmds.some((c) => c.startsWith("give Alice"))).toBe(true);
  });

  it("ignores non-matching advancements and expires stale challenges lazily", async () => {
    const store = {
      version: 1,
      servers: {
        smp: [
          {
            advancement: "Stone Age",
            startedBy: "A#1",
            startedById: "1",
            startedAt: 1,
            endsAt: 2, // long past
            status: "active",
          },
        ],
      },
    };
    const ctx = await setup(store);
    await ctx.run(line("Alice", "Stone Age"));

    const after = ctx.kvGet("challenges") as {
      servers: Record<string, Array<Record<string, unknown>>>;
    };
    const challenge = after.servers["smp"]![0]!;
    expect(challenge["status"]).toBe("expired"); // not won — it was stale
    expect(ctx.recordAdminAction).not.toHaveBeenCalled();
    // Only the regular advancement embed went out.
    expect(ctx.broadcastNotification).toHaveBeenCalledTimes(1);
  });

  it("queues the bonus item when the give is not confirmed", async () => {
    const stores: Record<string, unknown> = {
      challenges: {
        version: 1,
        servers: {
          smp: [
            {
              advancement: "Stone Age",
              item: "diamond",
              startedBy: "A#1",
              startedById: "1",
              startedAt: 1,
              status: "active",
            },
          ],
        },
      },
      pending: { version: 1, servers: {} },
    };
    vi.doMock("../../src/core/utils/paths.js", () => ({
      getRootDir: vi.fn().mockReturnValue("/tmp"),
    }));
    vi.doMock("../../src/core/utils/jsonStore.js", () => ({
      loadJson: vi.fn().mockResolvedValue({}),
      saveJson: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/core/config.js", () => ({
      loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
      getServerIds: vi.fn().mockReturnValue(["smp"]),
    }));
    vi.doMock("../../src/core/utils/stores/adminAudit.js", () => ({
      recordAdminAction: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
      broadcastNotification: vi.fn().mockResolvedValue(undefined),
      PLAYER_NAME: String.raw`\.?[a-zA-Z0-9_]{1,32}`,
    }));

    const { closeDbForTesting } = await import("../../src/core/db/index.js");
    const { kvGet, kvSet } = await import("../../src/core/db/kv.js");
    closeDbForTesting();
    kvSet("challenges", stores.challenges);
    kvSet("pendingRewards", stores.pending);

    const { registerAdvancementWatcher } = await import(
      "../../src/bot/logWatcher/watchers/log/advancements.js"
    );
    let handler!: (m: RegExpExecArray) => Promise<void>;
    let regex!: RegExp;
    const logWatcher = {
      server: {
        id: "smp",
        config: { useRcon: true },
        // give NOT confirmed:
        sendCommand: vi.fn().mockResolvedValue("Unknown item"),
      },
      register: (re: RegExp, fn: never) => {
        regex = re;
        handler = fn;
      },
    };
    registerAdvancementWatcher(logWatcher as never, {} as never, {});
    await handler(regex.exec(line("Alice", "Stone Age"))!);

    const pending = kvGet("pendingRewards") as {
      servers: Record<string, Record<string, Array<{ items: unknown[] }>>>;
    };
    expect(pending.servers["smp"]!["alice"]).toHaveLength(1);
    expect(pending.servers["smp"]!["alice"]![0]!.items).toEqual([
      { item: "diamond", amount: 1 },
    ]);
  });
});
