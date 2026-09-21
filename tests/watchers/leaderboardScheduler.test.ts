/**
 * leaderboardScheduler tests — exercises all 9 branches in checkAndPost().
 *
 * checkAndPost is private but runs via the postTimer setInterval.
 * Fake timers advance past CHECK_INTERVAL_MS (1 hour) to fire it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => "/tmp/lbsched",
}));

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ leaderboardInterval: "daily" }),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn().mockReturnValue(null),
}));

vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  buildLeaderboard: vi.fn().mockResolvedValue({
    entries: [],
    title: "LB",
    description: "",
    footerText: "",
  }),
  // The scheduler validates configured categories against this map;
  // only truthiness is consulted here.
  LEADERBOARD_STATS: { playtime: {}, mined: {} },
}));

vi.mock("../../src/bot/utils/embeds/statEmbeds.js", () => ({
  buildLeaderboardEmbed: vi.fn().mockReturnValue({
    setFooter: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../../src/core/utils/minecraft/snapshotUtils.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({}),
  getSnapshotClosestTo: vi.fn().mockResolvedValue(null),
}));

const TICK = 60 * 60_000 + 1; // just past 1-hour CHECK_INTERVAL_MS

import {
  startLeaderboardScheduler,
  nextLeaderboardRun,
} from "../../src/bot/logWatcher/watchers/schedulers/leaderboardScheduler.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import * as jsonStore from "../../src/core/utils/jsonStore.js";
import * as srvMod from "../../src/core/utils/server/server.js";
import * as statUtils from "../../src/core/utils/minecraft/statUtils.js";
import * as snapUtils from "../../src/core/utils/minecraft/snapshotUtils.js";
import { log } from "../../src/core/utils/logger.js";

function cleanup(r: unknown) {
  if (r && typeof r === "object") {
    const t = r as Record<string, ReturnType<typeof setInterval>>;
    if ("postTimer" in t) {
      clearInterval(t.postTimer);
      clearInterval(t.snapshotTimer);
      return;
    }
  }
  clearInterval(r as ReturnType<typeof setInterval>);
}

function fakeClient(send = vi.fn().mockResolvedValue(undefined)) {
  return { channels: { fetch: vi.fn().mockResolvedValue({ send }) } } as never;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  closeDbForTesting(); // schedule lives in kv — isolate tests from each other
  vi.mocked(jsonStore.loadJson).mockResolvedValue({});
  vi.mocked(srvMod.getServerInstance).mockReturnValue({
    id: "survival",
  } as never);
  vi.mocked(srvMod.getAllInstances).mockReturnValue([
    { id: "survival" } as never,
  ]);
  vi.mocked(snapUtils.getSnapshotClosestTo).mockResolvedValue(null);
});

afterEach(() => vi.useRealTimers());

// ── Branch 1: no channelId ─────────────────────────────────────────────────

it("skips a guild that has no leaderboard.channelId", async () => {
  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: {} },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(statUtils.buildLeaderboard).not.toHaveBeenCalled();
  cleanup(r);
});

// ── Branch 2: unknown interval ────────────────────────────────────────────

it("warns and skips a guild with an unrecognized interval string", async () => {
  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: { channelId: "ch1", interval: "yearly" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
    "leaderboard",
    expect.stringContaining("Unknown interval"),
  );
  cleanup(r);
});

// ── Branch 3: interval not yet elapsed ───────────────────────────────────

it("skips posting when the last post was too recent", async () => {
  kvSet("leaderboardSchedule", { g1: Date.now() - 60_000 }); // 1 min ago
  const send = vi.fn();
  const r = startLeaderboardScheduler(fakeClient(send), {
    g1: { leaderboard: { channelId: "ch1" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(send).not.toHaveBeenCalled(); // daily interval (24 h) hasn't elapsed
  cleanup(r);
});

// ── Branch 4: channel not found ───────────────────────────────────────────

it("warns when the Discord channel cannot be fetched", async () => {
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue(null) },
  } as never;
  const r = startLeaderboardScheduler(client, {
    g1: { leaderboard: { channelId: "missing-ch" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
    "leaderboard",
    expect.stringContaining("not found"),
  );
  cleanup(r);
});

// ── Branch 5: no server instance ─────────────────────────────────────────

it("warns and skips when no server instance is found", async () => {
  vi.mocked(srvMod.getServerInstance).mockReturnValue(null);
  vi.mocked(srvMod.getAllInstances).mockReturnValue([]);
  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: { channelId: "ch1" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
    "leaderboard",
    expect.stringContaining("No server instance"),
  );
  cleanup(r);
});

// ── Branch 8: no snapshot available ──────────────────────────────────────

it("uses 'no snapshot available' footer text when there is no snapshot", async () => {
  vi.mocked(snapUtils.getSnapshotClosestTo).mockResolvedValue(null);
  const { buildLeaderboardEmbed } = await import("../../src/bot/utils/embeds/statEmbeds.js");
  const setFooter = vi.fn().mockReturnThis();
  vi.mocked(buildLeaderboardEmbed).mockReturnValue({ setFooter } as never);

  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: { channelId: "ch1" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  expect(setFooter).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining("no snapshot") }),
  );
  cleanup(r);
});

// ── Branch 6+7: snapshot available ───────────────────────────────────────

describe("checkAndPost — snapshot exists", () => {
  it("uses a partial-period footer when the snapshot is younger than the interval", async () => {
    // 2-hour-old snapshot for a daily interval → partial period
    vi.mocked(snapUtils.getSnapshotClosestTo).mockResolvedValue({
      timestamp: Date.now() - 2 * 60 * 60 * 1000,
      players: {},
    } as never);
    const setFooter = vi.fn().mockReturnThis();
    vi.mocked(
      (await import("../../src/bot/utils/embeds/statEmbeds.js")).buildLeaderboardEmbed,
    ).mockReturnValue({ setFooter } as never);

    const r = startLeaderboardScheduler(fakeClient(), {
      g1: { leaderboard: { channelId: "ch1" } },
    } as never);
    await vi.advanceTimersByTimeAsync(TICK);
    // Footer should mention partial period (bot is young relative to daily interval)
    expect(setFooter).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringMatching(
          /partial period|tracking since|based on last/,
        ),
      }),
    );
    cleanup(r);
  });
});

// ── Advance schedule even on failure ───────────────────────────────────────

it("saves the schedule timestamp even when buildLeaderboard throws", async () => {
  vi.mocked(statUtils.buildLeaderboard).mockRejectedValue(
    new Error("stat read error"),
  );
  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: { channelId: "ch1" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  // The schedule must be persisted — advancing it prevents retry-spam.
  expect(kvGet("leaderboardSchedule")).toMatchObject({
    g1: expect.any(Number),
  });
  cleanup(r);
});

// ── nextLeaderboardRun — pure function, weekday/time anchoring ─────────────

describe("nextLeaderboardRun", () => {
  const TZ = "Europe/Berlin";

  it("returns null for a malformed postTime", () => {
    expect(nextLeaderboardRun("daily", "9am", undefined, TZ, Date.now())).toBeNull();
  });

  it("daily: the next occurrence of HH:MM, ignoring postDay", () => {
    // Monday 2026-01-05 10:00 Berlin time.
    const from = Date.UTC(2026, 0, 5, 9, 0, 0); // 10:00 CET (UTC+1)
    const due = nextLeaderboardRun("daily", "12:00", undefined, TZ, from);
    expect(due).not.toBeNull();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short",
    }).formatToParts(new Date(due!));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    expect(get("hour")).toBe("12");
    expect(get("minute")).toBe("00");
  });

  it("weekly: lands on the configured weekday, not just the next HH:MM", () => {
    // Monday 2026-01-05, asking for Friday ("FR") at 09:00.
    const from = Date.UTC(2026, 0, 5, 8, 0, 0); // 09:00 CET
    const due = nextLeaderboardRun("weekly", "09:00", "FR", TZ, from);
    expect(due).not.toBeNull();
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" })
      .format(new Date(due!));
    expect(weekday).toBe("Fri");
  });

  it("weekly: defaults to Monday when postDay is unset", () => {
    const from = Date.UTC(2026, 0, 5, 8, 0, 0); // Monday 09:00 CET
    const due = nextLeaderboardRun("weekly", "09:00", undefined, TZ, from);
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" })
      .format(new Date(due!));
    expect(weekday).toBe("Mon");
  });

  it("monthly: lands on the 1st of a month", () => {
    const from = Date.UTC(2026, 0, 15, 8, 0, 0); // mid-January
    const due = nextLeaderboardRun("monthly", "09:00", undefined, TZ, from);
    expect(due).not.toBeNull();
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" })
      .format(new Date(due!));
    expect(day).toBe("01");
  });

  it("holds across a DST transition (Europe/Berlin, spring forward)", () => {
    // 2026-03-29 is Berlin's DST transition (CET→CEST). Ask for 09:00 daily
    // from just before it and confirm the result still reads 09:00 local.
    const from = Date.UTC(2026, 2, 28, 8, 0, 0);
    const due = nextLeaderboardRun("daily", "09:00", undefined, TZ, from);
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hour12: false })
      .format(new Date(due!));
    expect(hour).toBe("09");
  });
});

// ── postTime/postDay integration through checkAndPost ──────────────────────

describe("checkAndPost — anchored scheduling", () => {
  it("does not post before the anchored time arrives", async () => {
    const send = vi.fn();
    // Anchor far in the future so no tick within this test reaches it.
    const future = new Date(Date.now() + 365 * 24 * 60 * 60_000);
    const hh = String(future.getUTCHours()).padStart(2, "0");
    const mm = String(future.getUTCMinutes()).padStart(2, "0");
    const r = startLeaderboardScheduler(fakeClient(send), {
      g1: { leaderboard: { channelId: "ch1", postTime: `${hh}:${mm}` } },
    } as never);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(send).not.toHaveBeenCalled();
    cleanup(r);
  });

  it("falls back to interval scheduling and warns on an invalid postTime", async () => {
    const r = startLeaderboardScheduler(fakeClient(), {
      g1: { leaderboard: { channelId: "ch1", postTime: "not-a-time" } },
    } as never);
    await vi.advanceTimersByTimeAsync(TICK);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith(
      "leaderboard",
      expect.stringContaining("invalid postTime"),
    );
    cleanup(r);
  });
});

// ── no guilds configured ──────────────────────────────────────────────────

it("returns only the snapshotTimer when no guild has a leaderboard channel", () => {
  const r = startLeaderboardScheduler(fakeClient(), {});
  // No postTimer should be created — result is the bare snapshotTimer
  expect(r).toBeTruthy();
  clearInterval(r as ReturnType<typeof setInterval>);
});
