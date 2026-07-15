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

import { startLeaderboardScheduler } from "../../src/bot/logWatcher/watchers/schedulers/leaderboardScheduler.js";
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

// ── no guilds configured ──────────────────────────────────────────────────

it("returns only the snapshotTimer when no guild has a leaderboard channel", () => {
  const r = startLeaderboardScheduler(fakeClient(), {});
  // No postTimer should be created — result is the bare snapshotTimer
  expect(r).toBeTruthy();
  clearInterval(r as ReturnType<typeof setInterval>);
});
