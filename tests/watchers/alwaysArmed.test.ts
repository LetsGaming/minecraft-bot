/**
 * The milestone watcher and the update notifier arm their timers
 * unconditionally and read the live config on each tick.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const cfg: { milestones?: Record<string, number[]>; updateNotifier?: { enabled?: boolean } } = {};
vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn(() => cfg),
}));

vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: vi.fn().mockReturnValue([]),
}));

vi.mock("../../src/core/utils/http.js", () => ({
  fetchJson: vi.fn().mockResolvedValue({ ok: false, failure: { kind: "network" } }),
  describeFailure: vi.fn().mockReturnValue("x"),
}));

import { startMilestoneWatcher } from "../../src/bot/logWatcher/watchers/monitors/milestoneWatcher.js";
import { startUpdateNotifier } from "../../src/bot/logWatcher/watchers/monitors/updateNotifier.js";
import { getAllInstances } from "../../src/core/utils/server/server.js";
import { fetchJson } from "../../src/core/utils/http.js";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  delete cfg.milestones;
  delete cfg.updateNotifier;
});
afterEach(() => vi.useRealTimers());

describe("startMilestoneWatcher", () => {
  it("arms a timer even when no milestones are configured, and stays idle", async () => {
    const timer = startMilestoneWatcher({} as never);
    expect(timer).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2 * HOUR);
    expect(getAllInstances).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("starts scanning once milestones appear in the live config", async () => {
    const timer = startMilestoneWatcher({} as never);
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(getAllInstances).not.toHaveBeenCalled();

    cfg.milestones = { playtime: [10] };
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(getAllInstances).toHaveBeenCalled();
    clearInterval(timer);
  });
});

describe("startUpdateNotifier", () => {
  it("arms a timer while disabled and makes no request", async () => {
    cfg.updateNotifier = { enabled: false };
    const timer = startUpdateNotifier({} as never);
    expect(timer).toBeTruthy();
    await vi.advanceTimersByTimeAsync(2 * DAY);
    expect(fetchJson).not.toHaveBeenCalled();
    clearInterval(timer);
  });

  it("checks for releases once the live config enables it", async () => {
    cfg.updateNotifier = { enabled: false };
    const timer = startUpdateNotifier({} as never);
    await vi.advanceTimersByTimeAsync(DAY);
    expect(fetchJson).not.toHaveBeenCalled();

    cfg.updateNotifier = { enabled: true };
    await vi.advanceTimersByTimeAsync(DAY);
    expect(fetchJson).toHaveBeenCalled();
    clearInterval(timer);
  });
});
