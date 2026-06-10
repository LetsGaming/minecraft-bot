/**
 * leaderboardScheduler tests — exercises all 9 branches in checkAndPost().
 *
 * checkAndPost is private but runs via the postTimer setInterval.
 * Fake timers advance past CHECK_INTERVAL_MS (1 hour) to fire it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../src/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../src/utils/utils.js", () => ({
  getRootDir: () => "/tmp/lbsched",
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ leaderboardInterval: "daily" }),
}));

vi.mock("../src/utils/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
  getServerInstance: vi.fn().mockReturnValue(null),
}));

vi.mock("../src/utils/statUtils.js", () => ({
  buildLeaderboard: vi.fn().mockResolvedValue({
    entries: [],
    title: "LB",
    description: "",
    footerText: "",
  }),
}));

vi.mock("../src/utils/statEmbeds.js", () => ({
  buildLeaderboardEmbed: vi.fn().mockReturnValue({
    setFooter: vi.fn().mockReturnThis(),
  }),
}));

vi.mock("../src/utils/snapshotUtils.js", () => ({
  takeSnapshot: vi.fn().mockResolvedValue({}),
  getSnapshotClosestTo: vi.fn().mockResolvedValue(null),
}));

const TICK = 60 * 60_000 + 1; // just past 1-hour CHECK_INTERVAL_MS

import { startLeaderboardScheduler } from "../src/logWatcher/watchers/leaderboardScheduler.js";
import * as utils from "../src/utils/utils.js";
import * as srvMod from "../src/utils/server.js";
import * as statUtils from "../src/utils/statUtils.js";
import * as snapUtils from "../src/utils/snapshotUtils.js";
import { log } from "../src/utils/logger.js";

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
  vi.mocked(utils.loadJson).mockResolvedValue({});
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
  vi.mocked(utils.loadJson).mockResolvedValue({ g1: Date.now() - 60_000 }); // 1 min ago
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
  const { buildLeaderboardEmbed } = await import("../src/utils/statEmbeds.js");
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
      (await import("../src/utils/statEmbeds.js")).buildLeaderboardEmbed,
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

// ── B-09: advance schedule even on failure ────────────────────────────────

it("saves the schedule timestamp even when buildLeaderboard throws (B-09)", async () => {
  vi.mocked(statUtils.buildLeaderboard).mockRejectedValue(
    new Error("stat read error"),
  );
  const r = startLeaderboardScheduler(fakeClient(), {
    g1: { leaderboard: { channelId: "ch1" } },
  } as never);
  await vi.advanceTimersByTimeAsync(TICK);
  // saveJson must be called — advancing the schedule prevents retry-spam
  expect(vi.mocked(utils.saveJson)).toHaveBeenCalled();
  cleanup(r);
});

// ── no guilds configured ──────────────────────────────────────────────────

it("returns only the snapshotTimer when no guild has a leaderboard channel", () => {
  const r = startLeaderboardScheduler(fakeClient(), {});
  // No postTimer should be created — result is the bare snapshotTimer
  expect(r).toBeTruthy();
  clearInterval(r as ReturnType<typeof setInterval>);
});
