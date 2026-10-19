import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const cfg = vi.hoisted(() => ({
  value: { milestones: { playtime: [10] }, guilds: {} } as Record<string, unknown>,
}));
vi.mock("../../src/core/config.js", () => ({
  loadConfig: () => cfg.value,
}));

const smp = { id: "smp" };
vi.mock("../../src/core/utils/server/server.js", () => ({
  getAllInstances: () => [smp],
}));

const stats = vi.hoisted(() => ({ value: {} as Record<string, number> }));
vi.mock("../../src/core/utils/minecraft/statUtils.js", () => ({
  LEADERBOARD_STATS: {
    playtime: {
      label: "Playtime",
      extract: (flat: { value: number }) => flat.value,
      format: (n: number) => String(n),
    },
  },
  loadAllStats: vi.fn(async () =>
    Object.fromEntries(Object.entries(stats.value).map(([uuid, value]) => [uuid, { value }])),
  ),
  flattenStats: (file: { value: number }) => file,
}));

vi.mock("../../src/core/utils/minecraft/whitelist.js", () => ({
  loadKnownPlayers: vi.fn(async () =>
    Object.keys(stats.value).map((uuid) => ({ uuid, name: `name-${uuid}` })),
  ),
}));

vi.mock("../../src/core/utils/minecraft/serverMessages.js", () => ({
  announce: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../src/bot/utils/embeds/embedUtils.js", () => ({
  createEmbed: vi.fn().mockReturnValue({ setFooter: vi.fn().mockReturnThis() }),
}));

const broadcast = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../../src/bot/logWatcher/watchers/notifyGuilds.js", () => ({
  broadcastNotification: broadcast,
}));

import { startMilestoneWatcher } from "../../src/bot/logWatcher/watchers/monitors/milestoneWatcher.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";

const FIRST_PASS = 5 * 60_000;
const HOUR = 60 * 60_000;

interface MilestoneDoc {
  servers: Record<string, Record<string, Record<string, number>>>;
  seeded: Record<string, Record<string, boolean>>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  closeDbForTesting();
  stats.value = {};
});
afterEach(() => vi.useRealTimers());

describe("milestone watcher", () => {
  it("announces at most ten crossings per pass and leaves the rest for the next pass", async () => {
    kvSet("milestones", { servers: { smp: { playtime: {} } }, seeded: { smp: { playtime: true } } });
    stats.value = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`u${i}`, 20]));

    const poller = startMilestoneWatcher({} as never);
    await vi.advanceTimersByTimeAsync(FIRST_PASS);
    expect(broadcast).toHaveBeenCalledTimes(10);
    const afterFirst = kvGet<MilestoneDoc>("milestones")!;
    expect(Object.keys(afterFirst.servers["smp"]!["playtime"]!)).toHaveLength(10);

    await vi.advanceTimersByTimeAsync(HOUR);
    expect(broadcast).toHaveBeenCalledTimes(12);
    const afterSecond = kvGet<MilestoneDoc>("milestones")!;
    expect(Object.keys(afterSecond.servers["smp"]!["playtime"]!)).toHaveLength(12);
    poller.stop();
  });

  it("seeds a baseline silently on the first pass", async () => {
    stats.value = { u1: 50 };
    const poller = startMilestoneWatcher({} as never);
    await vi.advanceTimersByTimeAsync(FIRST_PASS);
    expect(broadcast).not.toHaveBeenCalled();
    const doc = kvGet<MilestoneDoc>("milestones")!;
    expect(doc.seeded["smp"]!["playtime"]).toBe(true);
    expect(doc.servers["smp"]!["playtime"]!["u1"]).toBe(10);
    poller.stop();
  });

  it("does not seed a baseline from an empty stats map", async () => {
    stats.value = {};
    const poller = startMilestoneWatcher({} as never);
    await vi.advanceTimersByTimeAsync(FIRST_PASS);
    expect(kvGet<MilestoneDoc>("milestones")?.seeded?.["smp"]).toBeUndefined();

    stats.value = { u1: 50 };
    await vi.advanceTimersByTimeAsync(HOUR);
    expect(broadcast).not.toHaveBeenCalled();
    expect(kvGet<MilestoneDoc>("milestones")!.seeded["smp"]!["playtime"]).toBe(true);
    poller.stop();
  });
});
