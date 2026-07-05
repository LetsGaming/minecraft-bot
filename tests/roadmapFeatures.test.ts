/**
 * roadmapFeatures.test.ts — pure-logic units of the roadmap batch:
 * config diff summaries, wrapper version compare, milestone thresholds,
 * per-server reward pools, span polls, restart schedule parsing,
 * player-count history math, console-relay sanitizing, watch store,
 * streak leaderboards, and the optional last arg of defineCommand.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
  loadKnownPlayers: vi.fn().mockResolvedValue([]),
}));

vi.mock("../src/common/config.js", () => ({
  loadConfig: vi.fn(() => ({ guilds: {}, servers: {}, adminUsers: [] })),
  getServerIds: vi.fn(() => ["smp", "creative"]),
}));

import { loadJson, saveJson } from "../src/common/utils/utils.js";
import { summarizeConfigChanges } from "../src/common/utils/configDiff.js";
import { versionAtLeast } from "../src/common/utils/serverAccess.js";
import { highestCrossed } from "../src/bot/logWatcher/watchers/milestoneWatcher.js";
import { rewardPoolForServer } from "../src/common/utils/dailyStore.js";
import {
  pollServerIds,
  getOpenPollForServer,
  type Poll,
  type PollStore,
} from "../src/common/utils/pollStore.js";
import {
  parseScheduleTime,
  nextScheduledRun,
} from "../src/bot/logWatcher/watchers/restartScheduler.js";
import {
  buildActivitySparkline,
  busiestHours,
  type HourBucket,
} from "../src/common/utils/playerCountHistory.js";
import { sanitizeLogLine } from "../src/bot/logWatcher/watchers/consoleRelay.js";
import {
  takeMatchingWatches,
  type WatchStore,
} from "../src/common/utils/watchStore.js";
import { buildStreakLeaderboard } from "../src/common/utils/streakLeaderboard.js";
import { localDayOfWeek } from "../src/common/utils/time.js";
import type { DailyRewardsConfig } from "../src/common/types/index.js";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── configDiff ──────────────────────────────────────────────────────────────

describe("summarizeConfigChanges", () => {
  it("reports scalar transitions, guild feature changes, and additions", () => {
    const before = {
      language: "en",
      guilds: {
        "1": { notifications: { channelId: "a" } },
        "2": { language: "de" },
      },
    };
    const after = {
      language: "de",
      guilds: {
        "1": { notifications: { channelId: "b" }, chatBridge: { channelId: "c" } },
        "3": {},
      },
    };
    const lines = summarizeConfigChanges(before as never, after as never);
    expect(lines).toContain("language: en → de");
    expect(lines.some((l) => l.startsWith("guild 1: "))).toBe(true);
    expect(lines.find((l) => l.startsWith("guild 1: "))).toContain(
      "chatBridge added",
    );
    expect(lines.find((l) => l.startsWith("guild 1: "))).toContain(
      "notifications changed",
    );
    expect(lines).toContain("guild 2: removed");
    expect(lines).toContain("guild 3: added");
  });

  it("returns [] when nothing changed (servers are ignored)", () => {
    const cfg = { language: "en", servers: { smp: { a: 1 } }, guilds: {} };
    const changed = { ...cfg, servers: { smp: { a: 2 } } };
    expect(summarizeConfigChanges(cfg as never, changed as never)).toEqual([]);
  });
});

// ── versionAtLeast ──────────────────────────────────────────────────────────

describe("versionAtLeast", () => {
  it("compares numeric segments, not strings", () => {
    expect(versionAtLeast("1.10.2", "1.2.0")).toBe(true);
    expect(versionAtLeast("1.2.0", "1.2.0")).toBe(true);
    expect(versionAtLeast("1.1.9", "1.2.0")).toBe(false);
    expect(versionAtLeast("2.0", "1.9.9")).toBe(true);
    expect(versionAtLeast("1.2", "1.2.1")).toBe(false);
  });
});

// ── milestones ──────────────────────────────────────────────────────────────

describe("highestCrossed", () => {
  it("picks the highest reached threshold", () => {
    expect(highestCrossed([100, 1000, 10000], 5500)).toBe(1000);
    expect(highestCrossed([100, 1000], 99)).toBeNull();
    expect(highestCrossed([1000, 100], 150)).toBe(100); // order-independent
  });
});

// ── reward pools ────────────────────────────────────────────────────────────

describe("rewardPoolForServer", () => {
  const cfg: DailyRewardsConfig = {
    default: [{ item: "stone", amount: 1 }],
    streakBonuses: { "7": [{ item: "diamond", amount: 1 }] },
    servers: {
      creative: { default: [{ item: "glass", amount: 64 }] },
      hardcore: {
        default: [{ item: "totem", amount: 1 }],
        streakBonuses: { "3": [{ item: "gapple", amount: 1 }] },
      },
    },
  };

  it("falls back to the top-level pool without an override", () => {
    const pool = rewardPoolForServer(cfg, "smp");
    expect(pool.default[0]!.item).toBe("stone");
    expect(pool.streakBonuses?.["7"]).toBeDefined();
  });

  it("overrides field-by-field", () => {
    const creative = rewardPoolForServer(cfg, "creative");
    expect(creative.default[0]!.item).toBe("glass");
    // items overridden, bonuses inherited
    expect(creative.streakBonuses?.["7"]).toBeDefined();

    const hardcore = rewardPoolForServer(cfg, "hardcore");
    expect(hardcore.streakBonuses?.["3"]).toBeDefined();
    expect(hardcore.streakBonuses?.["7"]).toBeUndefined();
  });
});

// ── span polls ──────────────────────────────────────────────────────────────

describe("span polls", () => {
  const poll = (over: Partial<Poll>): Poll =>
    ({
      id: "p1",
      question: "q",
      options: ["a", "b"],
      guildId: null,
      channelId: "c",
      messageId: "m",
      serverId: "smp",
      createdBy: "x",
      createdById: "1",
      createdAt: 0,
      endsAt: Date.now() + 1000,
      votes: {},
      status: "open",
      ...over,
    }) as Poll;

  it("pollServerIds falls back to [serverId] for pre-span polls", () => {
    expect(pollServerIds(poll({}))).toEqual(["smp"]);
    expect(pollServerIds(poll({ serverIds: ["smp", "creative"] }))).toEqual([
      "smp",
      "creative",
    ]);
  });

  it("getOpenPollForServer matches every participant of a span poll", () => {
    const store: PollStore = {
      polls: [poll({ serverIds: ["smp", "creative"] })],
    } as PollStore;
    expect(getOpenPollForServer(store, "creative")?.id).toBe("p1");
    expect(getOpenPollForServer(store, "smp")?.id).toBe("p1");
    expect(getOpenPollForServer(store, "other")).toBeNull();
  });
});

// ── restart schedules ───────────────────────────────────────────────────────

describe("restart schedules", () => {
  it("parseScheduleTime accepts HH:MM and rejects garbage", () => {
    expect(parseScheduleTime("04:30")).toEqual({ hour: 4, minute: 30 });
    expect(parseScheduleTime("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseScheduleTime("24:00")).toBeNull();
    expect(parseScheduleTime("4:30")).toBeNull();
    expect(parseScheduleTime("nope")).toBeNull();
  });

  it("nextScheduledRun is strictly in the future and on an allowed day", () => {
    const from = Date.UTC(2026, 0, 5, 12, 0, 0); // fixed reference
    const run = nextScheduledRun({ time: "04:00" }, from);
    expect(run).not.toBeNull();
    expect(run!).toBeGreaterThan(from);
    expect(run! - from).toBeLessThanOrEqual(24 * 3_600_000 + 3_600_000);

    const dayCodes = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
    const onlyMonday = nextScheduledRun({ time: "04:00", days: ["MO"] }, from);
    expect(onlyMonday).not.toBeNull();
    expect(dayCodes[localDayOfWeek(onlyMonday!)]).toBe("MO");

    expect(nextScheduledRun({ time: "04:00", days: ["XX"] }, from)).toBeNull();
    expect(nextScheduledRun({ time: "bad" }, from)).toBeNull();
  });
});

// ── player-count history ────────────────────────────────────────────────────

describe("playerCountHistory math", () => {
  const HOUR = 3_600_000;

  it("buildActivitySparkline scales to the window peak and marks gaps", () => {
    const now = Math.floor(Date.now() / HOUR) * HOUR + 30 * 60_000;
    const bucket = (agesAgo: number, sum: number, max: number, samples = 1): HourBucket => ({
      h: Math.floor(now / HOUR) * HOUR - agesAgo * HOUR,
      sum,
      max,
      samples,
    });
    const series = [bucket(2, 10, 12), bucket(0, 4, 4)];
    const { line, peak } = buildActivitySparkline(series, now, 4);
    expect(line).toHaveLength(4);
    expect(peak).toBe(12);
    expect(line).toContain("·"); // empty buckets render as gaps
    expect(line.endsWith("·")).toBe(false); // the current bucket has data
  });

  it("busiestHours averages per local hour and ranks", () => {
    const base = Date.UTC(2026, 0, 5, 0, 0, 0);
    const series: HourBucket[] = [
      { h: base, sum: 10, max: 10, samples: 1 },
      { h: base + 24 * HOUR, sum: 20, max: 20, samples: 1 }, // same local hour next day
      { h: base + HOUR, sum: 2, max: 2, samples: 1 },
    ];
    const busy = busiestHours(series, 2);
    expect(busy).toHaveLength(2);
    expect(busy[0]!.avg).toBe(15); // (10 + 20) / 2
    expect(busy[1]!.avg).toBe(2);
  });
});

// ── console relay ───────────────────────────────────────────────────────────

describe("sanitizeLogLine", () => {
  it("strips ANSI, control chars, and neutralizes codeblock fences", () => {
    expect(sanitizeLogLine("\u001b[31mred\u001b[0m ok")).toBe("red ok");
    expect(sanitizeLogLine("a\r\nb\tc")).toBe("abc");
    expect(sanitizeLogLine("evil ``` fence")).not.toContain("```");
    expect(sanitizeLogLine("x".repeat(500))).toHaveLength(300);
  });
});

// ── watch store ─────────────────────────────────────────────────────────────

describe("takeMatchingWatches", () => {
  const store = (): WatchStore => ({
    version: 1,
    watches: [
      { id: "a", userId: "u1", kind: "server", serverId: "smp", createdAt: 0 },
      {
        id: "b",
        userId: "u2",
        kind: "player",
        serverId: "smp",
        player: "steve",
        createdAt: 0,
      },
      { id: "c", userId: "u3", kind: "server", serverId: "creative", createdAt: 0 },
    ],
  });

  it("removes and returns exactly the matching one-shots", async () => {
    vi.mocked(loadJson).mockResolvedValue(store() as never);
    const matched = await takeMatchingWatches({ kind: "server", serverId: "smp" });
    expect(matched.map((w) => w.id)).toEqual(["a"]);
    const saved = vi.mocked(saveJson).mock.calls[0]![1] as WatchStore;
    expect(saved.watches.map((w) => w.id)).toEqual(["b", "c"]);
  });

  it("matches players case-insensitively and saves nothing on a miss", async () => {
    vi.mocked(loadJson).mockResolvedValue(store() as never);
    const matched = await takeMatchingWatches({
      kind: "player",
      serverId: "smp",
      player: "Steve",
    });
    expect(matched.map((w) => w.id)).toEqual(["b"]);

    vi.mocked(saveJson).mockClear();
    vi.mocked(loadJson).mockResolvedValue(store() as never);
    const none = await takeMatchingWatches({
      kind: "player",
      serverId: "smp",
      player: "alex",
    });
    expect(none).toEqual([]);
    expect(vi.mocked(saveJson)).not.toHaveBeenCalled();
  });
});

// ── streak leaderboard ──────────────────────────────────────────────────────

describe("buildStreakLeaderboard", () => {
  it("ranks by the chosen key, resolves linked names, mentions the rest", async () => {
    vi.mocked(loadJson).mockImplementation(async (p: unknown) => {
      const file = String(p);
      if (file.includes("claimedDaily")) {
        return {
          version: 2,
          servers: {
            smp: {
              u1: { currentStreak: 5, longestStreak: 9, lastClaim: 0, bonusStreak: 0, rewards: [] },
              u2: { currentStreak: 7, longestStreak: 7, lastClaim: 0, bonusStreak: 0, rewards: [] },
              u3: { currentStreak: 0, longestStreak: 0, lastClaim: 0, bonusStreak: 0, rewards: [] },
            },
          },
        };
      }
      if (file.includes("linked")) return { u1: "SteveMC" };
      return {};
    });

    const current = await buildStreakLeaderboard("streak", "smp");
    expect(current.entries.map((e) => e.name)).toEqual(["<@u2>", "SteveMC"]);
    expect(current.entries[0]!.value).toBe(7);

    const longest = await buildStreakLeaderboard("longest_streak", "smp");
    expect(longest.entries[0]!.name).toBe("SteveMC");
    expect(longest.entries[0]!.value).toBe(9);
  });
});
