/**
 * The per-player audit assembly: session activity from the real (in-memory)
 * table, every other store mocked, so the sensitive gate and the per-section
 * failure tolerance are what is under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const DAY = 86_400_000;
const NOW = 100 * DAY + 12 * 3_600_000;

const mocks = vi.hoisted(() => ({
  getAuditEntry: vi.fn(),
  loadLinkedAccountsOrEmpty: vi.fn(),
  loadNotesStore: vi.fn(),
  loadWhitelistApplications: vi.fn(),
  loadTempBanStore: vi.fn(),
  loadClaimedStore: vi.fn(),
  findPlayer: vi.fn(),
  loadAllStats: vi.fn(),
}));

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../src/core/utils/stores/whitelistAudit.js", () => ({
  getAuditEntry: mocks.getAuditEntry,
}));
vi.mock("../../src/core/utils/stores/linkStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/linkStore.js")>()),
  loadLinkedAccountsOrEmpty: mocks.loadLinkedAccountsOrEmpty,
}));
vi.mock("../../src/core/utils/stores/noteStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/noteStore.js")>()),
  loadNotesStore: mocks.loadNotesStore,
}));
vi.mock("../../src/core/utils/stores/whitelistApplicationStore.js", () => ({
  loadWhitelistApplications: mocks.loadWhitelistApplications,
}));
vi.mock("../../src/core/utils/stores/tempBanStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/tempBanStore.js")>()),
  loadTempBanStore: mocks.loadTempBanStore,
}));
vi.mock("../../src/core/utils/stores/dailyStore.js", async (orig) => ({
  ...(await orig<typeof import("../../src/core/utils/stores/dailyStore.js")>()),
  loadClaimedStore: mocks.loadClaimedStore,
}));
vi.mock("../../src/core/utils/minecraft/playerUtils.js", () => ({
  findPlayer: mocks.findPlayer,
}));
vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  loadAllStats: mocks.loadAllStats,
  flattenStats: (f: { v?: number }) => [{ key: "x", value: f.v ?? 0 }],
  LEADERBOARD_STATS: {
    deaths: {
      label: "Deaths",
      extract: (flat: Array<{ value: number }>) => flat[0]?.value ?? 0,
      format: (v: number) => `${v} deaths`,
    },
  },
}));

import { closeDbForTesting } from "../../src/core/db/index.js";
import { openSession, closeSession } from "../../src/core/utils/stores/sessionStore.js";
import { buildPlayerDetail, dailyPlaytime } from "../../src/core/utils/minecraft/playerDetail.js";

const server = { id: "smp" } as never;
const UUID = "069a79f444e94726a5befca90e38aaf5";

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting();
  mocks.getAuditEntry.mockResolvedValue(null);
  mocks.loadLinkedAccountsOrEmpty.mockResolvedValue({});
  mocks.loadNotesStore.mockResolvedValue({ version: 1, players: {} });
  mocks.loadWhitelistApplications.mockReturnValue({ applications: [] });
  mocks.loadTempBanStore.mockResolvedValue({ version: 1, bans: {} });
  mocks.loadClaimedStore.mockResolvedValue({ version: 2, servers: {} });
  mocks.findPlayer.mockResolvedValue(null);
  mocks.loadAllStats.mockResolvedValue({});
});

describe("dailyPlaytime", () => {
  it("splits a session that crosses midnight across two UTC days", () => {
    const out = dailyPlaytime([{ joinedAt: DAY - 1000, leftAt: DAY + 2000 }], 10 * DAY);
    expect(out).toEqual([
      { day: 0, playtimeMs: 1000 },
      { day: DAY, playtimeMs: 2000 },
    ]);
  });

  it("counts an open session up to now and ignores time before the window", () => {
    const out = dailyPlaytime(
      [
        { joinedAt: 0, leftAt: 5000 },
        { joinedAt: 99 * DAY, leftAt: null },
      ],
      99 * DAY + 3000,
      10,
    );
    expect(out).toEqual([{ day: 99 * DAY, playtimeMs: 3000 }]);
  });
});

describe("buildPlayerDetail", () => {
  function seedActivity(): void {
    openSession("smp", "Steve", NOW - 2 * DAY);
    closeSession("smp", "Steve", NOW - 2 * DAY + 3_600_000);
    openSession("smp", "Steve", NOW - 1000);
  }

  it("returns null when nothing is known", async () => {
    expect(
      await buildPlayerDetail({ serverId: "smp", server, name: "Ghost", includeSensitive: true, now: NOW }),
    ).toBeNull();
  });

  it("summarises activity and never reads sensitive stores without access", async () => {
    seedActivity();
    const d = await buildPlayerDetail({ serverId: "smp", server, name: "steve", includeSensitive: false, now: NOW });

    expect(d).toMatchObject({
      serverId: "smp",
      name: "Steve",
      sensitiveAccess: false,
      sensitive: null,
      activity: { online: true, sessions: 2, historyDays: 365 },
    });
    expect(d!.activity.recentSessions[0]).toEqual({ joinedAt: NOW - 1000, leftAt: null });
    expect(d!.activity.longestSessionMs).toBe(3_600_000);
    expect(mocks.loadLinkedAccountsOrEmpty).not.toHaveBeenCalled();
    expect(mocks.loadNotesStore).not.toHaveBeenCalled();
  });

  it("does not reveal a player known only from sensitive data to a viewer without access", async () => {
    mocks.loadNotesStore.mockResolvedValue({
      version: 1,
      players: { [UUID]: { name: "Hidden", notes: [{ text: "x", author: "a", authorId: "1", createdAt: "t" }] } },
    });
    const d = await buildPlayerDetail({ serverId: "smp", server, name: "Hidden", includeSensitive: false, now: NOW });
    expect(d).toBeNull();
  });

  it("assembles the sensitive section when allowed", async () => {
    seedActivity();
    mocks.getAuditEntry.mockResolvedValue({
      username: "Steve",
      uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5",
      addedBy: "Admin#1",
      addedAt: "2026-01-01",
      server: "smp",
    });
    mocks.loadLinkedAccountsOrEmpty.mockResolvedValue({ d1: "steve" });
    mocks.loadNotesStore.mockResolvedValue({
      version: 1,
      players: {
        [UUID]: {
          name: "Steve",
          notes: [
            { text: "first", author: "Mod#1", authorId: "m", createdAt: "2026-02-01" },
            { text: "second", author: "Mod#2", authorId: "m", createdAt: "2026-03-01" },
          ],
        },
      },
    });
    mocks.loadWhitelistApplications.mockReturnValue({
      applications: [
        { id: "a1", serverId: "smp", mcName: "STEVE", status: "approved", userTag: "s#1", createdAt: 1, decidedBy: "Admin#1", decidedAt: 2 },
        { id: "a2", serverId: "smp", mcName: "steve", status: "pending", userTag: "s#1", createdAt: 3 },
        { id: "a3", serverId: "other", mcName: "steve", status: "denied", userTag: "s#1", createdAt: 4, decidedAt: 5 },
      ],
    });
    mocks.loadTempBanStore.mockResolvedValue({
      version: 1,
      bans: { "smp:steve": { player: "Steve", serverId: "smp", expiresAt: 9, bannedAt: 1, by: "Mod#1", reason: "grief" } },
    });
    mocks.loadClaimedStore.mockResolvedValue({
      version: 2,
      servers: { smp: { d1: { currentStreak: 4, longestStreak: 9, lastClaim: 77 } } },
    });
    mocks.loadAllStats.mockResolvedValue({ "069a79f4-44e9-4726-a5be-fca90e38aaf5": { v: 3 } });

    const d = await buildPlayerDetail({
      serverId: "smp",
      server,
      name: "Steve",
      includeSensitive: true,
      resolveDiscordName: async (id) => `name-of-${id}`,
      now: NOW,
    });

    expect(d!.uuid).toBe(UUID);
    expect(d!.stats).toEqual([{ key: "deaths", label: "Deaths", value: 3, formatted: "3 deaths" }]);
    expect(d!.sensitiveAccess).toBe(true);
    expect(d!.sensitive).toEqual({
      link: { discordId: "d1", displayName: "name-of-d1" },
      whitelist: { addedBy: "Admin#1", addedAt: "2026-01-01", removedBy: null, removedAt: null, server: "smp" },
      notes: [
        { text: "second", author: "Mod#2", createdAt: "2026-03-01" },
        { text: "first", author: "Mod#1", createdAt: "2026-02-01" },
      ],
      applications: [
        { id: "a1", status: "approved", userTag: "s#1", note: null, createdAt: 1, decidedBy: "Admin#1", decidedAt: 2 },
      ],
      tempBan: { expiresAt: 9, bannedAt: 1, by: "Mod#1", reason: "grief" },
      streak: { current: 4, longest: 9, lastClaim: 77 },
    });
  });

  it("keeps the rest of the page when one section's store fails", async () => {
    seedActivity();
    mocks.loadLinkedAccountsOrEmpty.mockRejectedValue(new Error("db locked"));
    mocks.loadNotesStore.mockRejectedValue(new Error("db locked"));
    mocks.loadAllStats.mockRejectedValue(new Error("wrapper down"));
    mocks.findPlayer.mockResolvedValue({ uuid: UUID, name: "Steve" });

    const d = await buildPlayerDetail({ serverId: "smp", server, name: "Steve", includeSensitive: true, now: NOW });

    expect(d!.activity.sessions).toBe(2);
    expect(d!.stats).toBeNull();
    expect(d!.sensitive).toMatchObject({ link: null, notes: [] });
  });

  it("falls back to a server lookup for the uuid and leaves stats null without one", async () => {
    seedActivity();
    const d = await buildPlayerDetail({ serverId: "smp", server, name: "Steve", includeSensitive: false, now: NOW });
    expect(d!.uuid).toBeNull();
    expect(d!.stats).toBeNull();

    mocks.findPlayer.mockResolvedValue({ uuid: "069a79f4-44e9-4726-a5be-fca90e38aaf5", name: "Steve" });
    const again = await buildPlayerDetail({ serverId: "smp", server, name: "Steve", includeSensitive: false, now: NOW });
    expect(again!.uuid).toBe(UUID);
  });
});
