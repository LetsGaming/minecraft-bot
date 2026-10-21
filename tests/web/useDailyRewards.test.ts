import { describe, it, expect, vi, beforeEach } from "vitest";

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { useDailyRewards } from "../../src/web/frontend/src/composables/useDailyRewards.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";
import { sharePercent, totalWeight } from "@mcbot/schema/dailyRewards.js";

const SHARED = {
  default: [
    { item: "stone", amount: 64, weight: 10 },
    { item: "iron_ingot", amount: 8, weight: 30 },
    { item: "diamond", amount: 1, weight: 60 },
  ],
  streakBonuses: { "7": [{ item: "emerald", amount: 3 }] },
  bonusChance: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/rewards") {
      return { shared: { pool: structuredClone(SHARED), problems: [], hash: "h1", exists: true }, shipped: null };
    }
    if (path === "/api/servers/smp/rewards") {
      return {
        override: { pool: { bonusChance: 20 }, problems: [], hash: "o1", exists: true },
        shared: { pool: structuredClone(SHARED), problems: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  net.apiSend.mockResolvedValue({ hash: "next" });
});

describe("useDailyRewards", () => {
  it("edits a chance in percent by changing that one weight", async () => {
    const r = useDailyRewards();
    await r.open("");
    r.setPercent(0, 50);
    const pool = r.items.value;
    expect(sharePercent(pool[0]!.weight!, totalWeight(pool))).toBeCloseTo(50, 3);
    expect(pool[1]!.weight).toBe(30);
    expect(pool[2]!.weight).toBe(60);
    expect(r.dirtyKeys.value).toEqual(["default"]);
  });

  it("adds a new item at the pool's average weight", async () => {
    const r = useDailyRewards();
    await r.open("");
    r.addItem("golden_apple", 2);
    // (10 + 30 + 60) / 3, rounded to six significant digits
    expect(r.items.value.at(-1)).toEqual({ item: "golden_apple", amount: 2, weight: 33.3333 });
  });

  it("shows inherited fields from the shared pool and seeds an override from them", async () => {
    const r = useDailyRewards();
    await r.open("smp");
    expect(r.overrides("default")).toBe(false);
    expect(r.effective("default")).toHaveLength(3);
    expect(r.effective("bonusChance")).toBe(20);

    r.setOverride("default", true);
    expect(r.overrides("default")).toBe(true);
    r.removeItem(0);
    // The shared pool itself is untouched by editing the copy.
    expect(r.sharedPool.value.default).toHaveLength(3);

    r.setOverride("bonusChance", false);
    expect(r.effective("bonusChance")).toBe(5);
  });

  it("saves the draft with the hash it loaded", async () => {
    const r = useDailyRewards();
    await r.open("smp");
    r.setOverride("streakBonuses", true);
    r.addBonusDay(14);
    r.addBonusItem("14", "diamond_block", 2);
    expect(await r.save()).toBe(true);
    expect(net.apiSend).toHaveBeenCalledWith("PUT", "/api/servers/smp/rewards", {
      baseHash: "o1",
      pool: {
        bonusChance: 20,
        streakBonuses: { "7": [{ item: "emerald", amount: 3 }], "14": [{ item: "diamond_block", amount: 2 }] },
      },
    });
  });

  it("stays clean when a field re-emits the value it displays", async () => {
    const r = useDailyRewards();
    await r.open("");
    const row = r.items.value[0]!;
    const shown = Math.round(sharePercent(row.weight!, r.total.value) * 1000) / 1000;
    r.setPercent(0, shown);
    r.setWeight(0, row.weight!);
    expect(r.dirty.value).toBe(false);
  });

  it("rescales weights to 100 without moving any chance", async () => {
    const r = useDailyRewards();
    await r.open("");
    r.setWeight(0, 20); // 20 / 110
    r.normalizeWeights();
    expect(totalWeight(r.items.value)).toBeCloseTo(100, 3);
    expect(sharePercent(r.items.value[0]!.weight!, 100)).toBeCloseTo((20 / 110) * 100, 3);
  });
});
