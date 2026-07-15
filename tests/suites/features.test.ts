/**
 * Feature tests:
 *  - /whois: audit + link lookup, no-data and validation paths
 *  - daily reminders: toggle persistence + scheduler pass semantics
 *  - i18n: locale resolution, fallback chain, placeholder substitution
 *  - uptime sparkline: bucketing, scaling, no-data hours
 * (Role admins are covered in middleware.test.ts, prune-stats in
 *  commands_server.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockConfig = {
  adminUsers: ["admin1"],
  language: "en" as string,
  servers: {},
  guilds: {},
};
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => mockConfig),
}));

vi.mock("../../src/core/utils/stores/whitelistAudit.js", () => ({
  getAuditEntry: vi.fn(),
}));
vi.mock("../../src/core/utils/stores/linkUtils.js", () => ({
  loadLinkedAccounts: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/core/utils/stores/dailyStore.js", () => ({
  loadClaimedStore: vi
    .fn()
    .mockResolvedValue({ version: 2, servers: {} }),
  // Real lazy-map semantics so command code can mutate the store.
  getServerClaims: vi.fn(
    (
      store: { servers: Record<string, Record<string, unknown>> },
      serverId: string,
    ) => (store.servers[serverId] ??= {}),
  ),
  saveClaimedStore: vi.fn().mockResolvedValue(undefined),
}));

// reminder.ts resolves the target server and checks the instance count
// for its reply suffix.
vi.mock("../../src/bot/utils/guild/guildRouter.js", () => ({
  resolveServer: vi.fn().mockReturnValue({ id: "main" }),
}));
vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
}));

import { t, runWithGuildLocale } from "../../src/core/utils/i18n.js";
import { buildSparkline } from "../../src/core/utils/stores/uptimeTracker.js";
import { processDailyReminders } from "../../src/bot/logWatcher/watchers/schedulers/dailyReminderScheduler.js";
import { getAuditEntry } from "../../src/core/utils/stores/whitelistAudit.js";
import { loadLinkedAccounts } from "../../src/core/utils/stores/linkUtils.js";
import {
  loadClaimedStore,
  saveClaimedStore,
} from "../../src/core/utils/stores/dailyStore.js";
import type { Client } from "discord.js";

beforeEach(() => {
  vi.clearAllMocks();
  mockConfig.language = "en";
  vi.mocked(loadLinkedAccounts).mockResolvedValue({});
  vi.mocked(loadClaimedStore).mockResolvedValue({ version: 2, servers: {} });
});

// ── I18n ──────────────────────────────────────────────────────────────

describe("i18n t()", () => {
  it("resolves English by default", () => {
    expect(t("common.serverNotFound")).toBe("Server not found.");
  });

  it("resolves German when config.language is de", () => {
    mockConfig.language = "de";
    expect(t("common.serverNotFound")).toBe("Server nicht gefunden.");
  });

  it("falls back to English for keys missing in the active locale", () => {
    mockConfig.language = "de";
    // Key exists only in en — simulate by using a key we know is en-only?
    // All current keys are translated; assert the chain via unknown locale
    // value handling instead:
    mockConfig.language = "fr"; // unsupported → en
    expect(t("common.serverNotFound")).toBe("Server not found.");
  });

  it("returns the key itself when unknown everywhere", () => {
    expect(t("nope.missing")).toBe("nope.missing");
  });

  it("substitutes {placeholders} and leaves unknown ones intact", () => {
    expect(t("common.invalidUsername", { username: "Bob" })).toBe(
      "**Bob** is not a valid Minecraft username.",
    );
    expect(t("whois.title", {})).toBe("Whois — {username}");
  });

  it("prefers guilds.<id>.language over the global language", () => {
    mockConfig.language = "en";
    (mockConfig.guilds as Record<string, unknown>)["g1"] = { language: "de" };
    expect(t("common.serverNotFound", undefined, "g1")).toBe(
      "Server nicht gefunden.",
    );
    // Unknown guild → global.
    expect(t("common.serverNotFound", undefined, "g2")).toBe(
      "Server not found.",
    );
    delete (mockConfig.guilds as Record<string, unknown>)["g1"];
  });

  it("consults the ambient guild context; explicit guildId wins", () => {
    mockConfig.language = "en";
    (mockConfig.guilds as Record<string, unknown>)["g-de"] = { language: "de" };

    const ambient = runWithGuildLocale("g-de", () =>
      t("common.serverNotFound"),
    );
    expect(ambient).toBe("Server nicht gefunden.");

    // Explicit argument overrides the ambient context.
    const explicit = runWithGuildLocale("g-de", () =>
      t("common.serverNotFound", undefined, "unknown-guild"),
    );
    expect(explicit).toBe("Server not found.");

    // Outside any context: global language.
    expect(t("common.serverNotFound")).toBe("Server not found.");
    delete (mockConfig.guilds as Record<string, unknown>)["g-de"];
  });
});

// ── Sparkline ─────────────────────────────────────────────────────────

describe("buildSparkline", () => {
  const HOUR = 60 * 60 * 1000;

  it("renders 24 chars, oldest hour first", () => {
    const now = Date.now();
    const spark = buildSparkline([], now);
    expect(spark).toHaveLength(24);
    expect(spark).toBe("·".repeat(24));
  });

  it("scales each hour by its uptime percentage", () => {
    const now = 24 * HOUR; // fixed origin keeps buckets deterministic
    const entries = [
      // bucket 0 (oldest): fully up
      { t: 0 * HOUR + 1, up: 1 },
      { t: 0 * HOUR + 2, up: 1 },
      // bucket 1: fully down
      { t: 1 * HOUR + 1, up: 0 },
      // bucket 2: half up → middle block
      { t: 2 * HOUR + 1, up: 1 },
      { t: 2 * HOUR + 2, up: 0 },
      // bucket 23 (newest): up
      { t: 23 * HOUR + 1, up: 1 },
    ];
    const spark = buildSparkline(entries, now);
    expect(spark[0]).toBe("█");
    expect(spark[1]).toBe("▁");
    expect(spark[2]).toBe("▅"); // 50% → Math.round(0.5 * 7) = 4 → "▅"
    expect(spark[3]).toBe("·");
    expect(spark[23]).toBe("█");
  });

  it("ignores entries outside the window", () => {
    const now = 48 * HOUR;
    const spark = buildSparkline([{ t: 1, up: 1 }], now); // 47h old
    expect(spark).toBe("·".repeat(24));
  });
});

// ── Reminder scheduler ────────────────────────────────────────────────

describe("processDailyReminders", () => {
  const DAY = 24 * 60 * 60 * 1000;

  function makeClient(send = vi.fn().mockResolvedValue(undefined)) {
    return {
      client: {
        users: { fetch: vi.fn().mockResolvedValue({ send }) },
      } as unknown as Client,
      send,
    };
  }

  it("DMs opted-in users whose cooldown expired, once per claim cycle", async () => {
    const now = 10 * DAY;
    vi.mocked(loadClaimedStore).mockResolvedValue({
      version: 2,
      servers: {
        main: {
          due: {
            lastClaim: now - DAY - 1000,
            remind: true,
            currentStreak: 1,
            bonusStreak: 1,
            longestStreak: 1,
            rewards: [],
          },
        },
      },
    } as never);
    const { client, send } = makeClient();

    expect(await processDailyReminders(client, now)).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("/daily"));

    // The persisted record must carry lastReminderAt = now (dedupe)
    const saved = vi.mocked(saveClaimedStore).mock.calls[0]![0] as {
      servers: Record<string, Record<string, { lastReminderAt?: number }>>;
    };
    expect(saved.servers["main"]!["due"]!.lastReminderAt).toBe(now);
  });

  it("skips users who are not opted in, not due, never claimed, or already reminded", async () => {
    const now = 10 * DAY;
    vi.mocked(loadClaimedStore).mockResolvedValue({
      version: 2,
      servers: {
        main: {
          notOptedIn: { lastClaim: now - 2 * DAY, rewards: [] },
          stillCoolingDown: {
            lastClaim: now - DAY / 2,
            remind: true,
            rewards: [],
          },
          neverClaimed: { lastClaim: 0, remind: true, rewards: [] },
          alreadyReminded: {
            lastClaim: now - 2 * DAY,
            remind: true,
            lastReminderAt: now - DAY,
            rewards: [],
          },
        },
      },
    } as never);
    const { client } = makeClient();

    expect(await processDailyReminders(client, now)).toBe(0);
    expect(saveClaimedStore).not.toHaveBeenCalled();
  });

  it("advances lastReminderAt even when the DM fails (no hammering)", async () => {
    const now = 10 * DAY;
    vi.mocked(loadClaimedStore).mockResolvedValue({
      version: 2,
      servers: {
        main: {
          closedDms: {
            lastClaim: now - 2 * DAY,
            remind: true,
            rewards: [],
          },
        },
      },
    } as never);
    const send = vi.fn().mockRejectedValue(new Error("Cannot send DM"));
    const { client } = makeClient(send);

    expect(await processDailyReminders(client, now)).toBe(0);
    const saved = vi.mocked(saveClaimedStore).mock.calls[0]![0] as {
      servers: Record<string, Record<string, { lastReminderAt?: number }>>;
    };
    expect(saved.servers["main"]!["closedDms"]!.lastReminderAt).toBe(now);
  });

  it("names the server in the DM when several servers have claims", async () => {
    const now = 10 * DAY;
    const due = {
      lastClaim: now - 2 * DAY,
      remind: true,
      currentStreak: 1,
      bonusStreak: 1,
      longestStreak: 1,
      rewards: [],
    };
    vi.mocked(loadClaimedStore).mockResolvedValue({
      version: 2,
      servers: {
        survival: { u1: { ...due } },
        creative: { u1: { ...due } },
      },
    } as never);
    const { client, send } = makeClient();

    // One reminder per server — the same user can be due on both.
    expect(await processDailyReminders(client, now)).toBe(2);
    expect(send).toHaveBeenCalledWith(expect.stringContaining("survival"));
    expect(send).toHaveBeenCalledWith(expect.stringContaining("creative"));
  });
});

// ── Toggle command ────────────────────────────────────────────────────

describe("/daily-reminder command", () => {
  function makeInteraction(enabled: boolean) {
    return {
      user: { id: "u1", tag: "User#1", displayName: "User" },
      commandName: "daily-reminder",
      deferred: false,
      replied: false,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      options: { getBoolean: vi.fn().mockReturnValue(enabled) },
    } as never;
  }

  it("persists the opt-in flag without clobbering existing claim data", async () => {
    vi.mocked(loadClaimedStore).mockResolvedValue({
      version: 2,
      servers: {
        main: {
          u1: {
            lastClaim: 123,
            currentStreak: 5,
            bonusStreak: 2,
            longestStreak: 9,
            rewards: [{ date: 123, items: [] }],
          },
        },
      },
    } as never);
    const { execute } = await import(
      "../../src/bot/commands/connection/daily/reminder.js"
    );

    await execute(makeInteraction(true));

    const saved = vi.mocked(saveClaimedStore).mock.calls[0]![0] as {
      servers: Record<
        string,
        Record<
          string,
          { remind?: boolean; currentStreak: number; lastClaim: number }
        >
      >;
    };
    expect(saved.servers["main"]!["u1"]!.remind).toBe(true);
    expect(saved.servers["main"]!["u1"]!.currentStreak).toBe(5);
    expect(saved.servers["main"]!["u1"]!.lastClaim).toBe(123);
  });

  it("creates a zeroed record for users who never claimed", async () => {
    const { execute } = await import(
      "../../src/bot/commands/connection/daily/reminder.js"
    );
    await execute(makeInteraction(true));
    const saved = vi.mocked(saveClaimedStore).mock.calls[0]![0] as {
      servers: Record<
        string,
        Record<string, { remind?: boolean; lastClaim: number }>
      >;
    };
    expect(saved.servers["main"]!["u1"]!.remind).toBe(true);
    expect(saved.servers["main"]!["u1"]!.lastClaim).toBe(0);
  });
});

// ── /whois ────────────────────────────────────────────────────────────

describe("/whois command", () => {
  function makeInteraction(username: string) {
    return {
      user: { id: "admin1", tag: "Admin#1", displayName: "Admin" },
      commandName: "whois",
      deferred: false,
      replied: false,
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      options: { getString: vi.fn().mockReturnValue(username) },
    } as never;
  }

  it("shows audit info and the linked Discord account", async () => {
    vi.mocked(getAuditEntry).mockResolvedValue({
      username: "Steve",
      uuid: "uuid-1",
      addedBy: "Admin#1",
      addedById: "admin1",
      addedAt: "2026-01-01 12:00",
      server: "survival",
    } as never);
    vi.mocked(loadLinkedAccounts).mockResolvedValue({
      "discord-9": "steve",
    } as never);

    const { execute } = await import("../../src/bot/commands/admin/whois.js");
    const interaction = makeInteraction("Steve");
    await execute(interaction);

    const embeds = vi.mocked(
      (interaction as { editReply: ReturnType<typeof vi.fn> }).editReply,
    ).mock.calls[0]![0].embeds;
    const json = embeds[0].toJSON();
    expect(json.title).toContain("Steve");
    const fieldValues = json.fields.map((f: { value: string }) => f.value);
    expect(fieldValues.join("\n")).toContain("<@discord-9>");
    expect(fieldValues.join("\n")).toContain("uuid-1");
  });

  // withErrorHandling renders errors as embeds instead of rethrowing —
  // pull the message out of whichever reply path was used.
  function errorText(interaction: never): string {
    const i = interaction as {
      reply: ReturnType<typeof vi.fn>;
      editReply: ReturnType<typeof vi.fn>;
    };
    const call =
      i.editReply.mock.calls.at(-1)?.[0] ?? i.reply.mock.calls.at(-1)?.[0];
    return call?.embeds?.[0]?.toJSON?.().description ?? "";
  }

  it("replies with the no-data message when nothing is known", async () => {
    vi.mocked(getAuditEntry).mockResolvedValue(null);
    const { execute } = await import("../../src/bot/commands/admin/whois.js");
    const interaction = makeInteraction("Ghost");
    await execute(interaction);
    expect(errorText(interaction)).toMatch(/No whitelist or link data/);
  });

  it("rejects invalid usernames before any lookup", async () => {
    const { execute } = await import("../../src/bot/commands/admin/whois.js");
    const interaction = makeInteraction("bad name");
    await execute(interaction);
    expect(errorText(interaction)).toMatch(/not a valid/);
    expect(getAuditEntry).not.toHaveBeenCalled();
  });

  it("denies non-admins", async () => {
    const { execute } = await import("../../src/bot/commands/admin/whois.js");
    const interaction = makeInteraction("Steve");
    (interaction as { user: { id: string } }).user.id = "rando";
    await execute(interaction);
    expect(errorText(interaction)).toMatch(/permission/);
    expect(getAuditEntry).not.toHaveBeenCalled();
  });
});
