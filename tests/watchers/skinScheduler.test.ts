/**
 * The skin sweep: which players it covers, what it prunes, what it asks the
 * resolver for, and when it runs. The resolver is faked; sessions and the head
 * store are the real ones on the test database.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  linked: {} as Record<string, string>,
  refresh: vi.fn(),
}));

vi.mock("../../src/core/utils/stores/linkStore.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadLinkedAccountsOrEmpty: vi.fn(async () => mocks.linked),
}));
vi.mock("../../src/core/utils/minecraft/skinResolver.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  refreshSkins: mocks.refresh,
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import { log } from "../../src/core/utils/logger.js";
import { getSkin, setSkin } from "../../src/core/utils/stores/headStore.js";
import {
  runSkinSweep,
  startSkinScheduler,
  sweepNames,
} from "../../src/bot/logWatcher/watchers/schedulers/skinScheduler.js";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY = 86_400_000;
const MIN = 60_000;

function session(server: string, name: string, joinedAt: number, leftAt: number | null): void {
  getDb()
    .prepare("INSERT INTO player_sessions (server_id, name_lower, name, joined_at, left_at) VALUES (?, ?, ?, ?, ?)")
    .run(server, name.toLowerCase(), name, joinedAt, leftAt);
}

const sweepLogs = (): string[] =>
  vi
    .mocked(log.info)
    .mock.calls.filter((c) => c[0] === "skins")
    .map((c) => String(c[1]));

const NOTHING = { asked: 0, changed: 0, failed: 0, skipped: 0, stoppedEarly: false };

beforeEach(() => {
  closeDbForTesting();
  vi.clearAllMocks();
  mocks.linked = {};
  mocks.refresh.mockReset().mockResolvedValue(NOTHING);
});

afterEach(() => {
  vi.useRealTimers();
  closeDbForTesting();
});

describe("sweepNames", () => {
  it("covers players seen in the last 60 days, newest first, and leaves out older ones", async () => {
    session("smp", "Recent", NOW - DAY, NOW - DAY + MIN);
    session("smp", "Newest", NOW - MIN, NOW - 1);
    session("smp", "Ancient", NOW - 61 * DAY, NOW - 61 * DAY + MIN);
    expect(await sweepNames(NOW)).toEqual(["Newest", "Recent"]);
  });

  it("includes a player who is online now", async () => {
    session("smp", "Online", NOW - 5 * MIN, null);
    expect(await sweepNames(NOW)).toEqual(["Online"]);
  });

  it("adds linked accounts, one name per player whatever the casing or the server", async () => {
    session("smp", "Steve", NOW - DAY, NOW - DAY + MIN);
    session("creative", "steve", NOW - 2 * DAY, NOW - 2 * DAY + MIN);
    mocks.linked = { "1": "STEVE", "2": "Linked_Only" };
    const names = await sweepNames(NOW);
    expect(names.map((n) => n.toLowerCase()).sort()).toEqual(["linked_only", "steve"]);
    expect(names).toHaveLength(2);
  });
});

describe("runSkinSweep", () => {
  it("prunes players that are no longer covered and asks the resolver for the rest", async () => {
    session("smp", "Steve", NOW - DAY, NOW - DAY + MIN);
    mocks.linked = { "1": "Linked_One" };
    setSkin("Steve", "a".repeat(64), NOW - 2 * DAY);
    setSkin("Gone_Player", "b".repeat(64), NOW - 2 * DAY);

    await runSkinSweep(NOW);

    expect(getSkin("Gone_Player")).toBeNull();
    expect(getSkin("Steve")).not.toBeNull();
    expect(mocks.refresh).toHaveBeenCalledWith(["Steve", "Linked_One"], {
      maxAgeMs: 55 * MIN,
      spacingMs: 1_500,
    });
  });

  it("logs a line only when something was asked or the sweep stopped early", async () => {
    session("smp", "Steve", NOW - DAY, NOW - DAY + MIN);
    await runSkinSweep(NOW);
    expect(sweepLogs()).toEqual([]);

    mocks.refresh.mockResolvedValue({ ...NOTHING, asked: 2, changed: 1 });
    await runSkinSweep(NOW);
    expect(sweepLogs()[0]).toContain("asked 2, changed 1");

    vi.mocked(log.info).mockClear();
    mocks.refresh.mockResolvedValue({ ...NOTHING, stoppedEarly: true });
    await runSkinSweep(NOW);
    expect(sweepLogs()[0]).toContain("stopped early");
  });

  it("returns what the resolver reported", async () => {
    mocks.refresh.mockResolvedValue({ ...NOTHING, asked: 3, failed: 1 });
    expect(await runSkinSweep(NOW)).toMatchObject({ asked: 3, failed: 1 });
  });
});

describe("startSkinScheduler", () => {
  it("first sweeps 30 seconds after start, then every 30 minutes, until stopped", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const poller = startSkinScheduler();

    await vi.advanceTimersByTimeAsync(29_000);
    expect(mocks.refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.refresh).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);

    poller.stop();
    await vi.advanceTimersByTimeAsync(2 * 30 * MIN);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
  });

  it("keeps running after a failed sweep", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    mocks.refresh.mockRejectedValueOnce(new Error("store down")).mockResolvedValue(NOTHING);
    const poller = startSkinScheduler();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30 * MIN);
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    poller.stop();
  });
});
