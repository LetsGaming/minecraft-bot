import { describe, it, expect } from "vitest";
import {
  DEFAULT_MAX_STREAK,
  compareMcVersions,
  deriveMaxStreak,
  drawFromPool,
  isAvailableOn,
  itemChances,
  pick,
  rollRewards,
  tierOdds,
} from "@mcbot/schema/rewardRoll.js";
import type { DailyRewardItem } from "@mcbot/schema/dailyRewards.js";

function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

const POOL = {
  default: [
    { id: "a", item: "minecraft:apple", amount: 1, weight: 1 },
    { id: "b", item: "minecraft:bread", amount: 2, weight: 3 },
  ],
  streakBonuses: { "3": [{ id: "s", item: "minecraft:cake", amount: 1 }] },
};

describe("rewardRoll", () => {
  it("picks by weight", () => {
    expect(pick(POOL.default, () => 0).item).toBe("minecraft:apple");
    expect(pick(POOL.default, () => 0.5).item).toBe("minecraft:bread");
  });

  it("draws in the order main (tier, entry), chance roll, bonus (tier, entry)", () => {
    const rolled = rollRewards({ ...POOL, bonusChance: 50 }, 3, sequence(0, 0, 0.1, 0.5, 0.9));
    expect(rolled.main).toEqual({ item: "minecraft:apple", amount: 1, weight: 1 });
    expect(rolled.randomBonus).toEqual({ item: "minecraft:bread", amount: 2, weight: 3 });
    expect(rolled.streakBonus).toEqual([{ item: "minecraft:cake", amount: 1 }]);
  });

  it("makes no chance roll when bonusChance is 0, and misses above the chance", () => {
    const calls: number[] = [];
    const rng = () => {
      calls.push(0);
      return 0.9;
    };
    expect(rollRewards({ ...POOL, bonusChance: 0 }, 1, rng).randomBonus).toBeNull();
    expect(calls).toHaveLength(2);
    expect(rollRewards({ ...POOL, bonusChance: 10 }, 1, sequence(0, 0, 0.99)).randomBonus).toBeNull();
  });

  it("hands out plain stacks without editor ids", () => {
    const rolled = rollRewards({ ...POOL, bonusChance: 100 }, 3, sequence(0, 0, 0));
    for (const stack of [rolled.main, rolled.randomBonus!, ...rolled.streakBonus]) {
      expect(stack).not.toHaveProperty("id");
      expect(stack).not.toHaveProperty("detachedFrom");
    }
  });

  it("uses the highest milestone as the cycle length", () => {
    expect(deriveMaxStreak({ "3": [], "14": [] })).toBe(14);
    expect(deriveMaxStreak({})).toBe(DEFAULT_MAX_STREAK);
    expect(deriveMaxStreak(undefined)).toBe(DEFAULT_MAX_STREAK);
  });
});

const TIERED = {
  default: [
    { item: "minecraft:stick", amount: 1, tier: "dirt", weight: 1 },
    { item: "minecraft:bread", amount: 8, tier: "common", weight: 3 },
    { item: "minecraft:apple", amount: 8, tier: "common", weight: 1 },
    { item: "minecraft:elytra", amount: 1, tier: "legendary", weight: 1 },
  ] as DailyRewardItem[],
  tierChances: { dirt: 10, common: 60, legendary: 30 },
};

describe("tier first draw", () => {
  it("rolls the tier by the tier chances, then the entry by weight", () => {
    expect(drawFromPool(TIERED, sequence(0.05, 0)).item).toBe("minecraft:stick");
    expect(drawFromPool(TIERED, sequence(0.5, 0)).item).toBe("minecraft:bread");
    expect(drawFromPool(TIERED, sequence(0.5, 0.9)).item).toBe("minecraft:apple");
    expect(drawFromPool(TIERED, sequence(0.99, 0)).item).toBe("minecraft:elytra");
  });

  it("reports the configured tier odds", () => {
    const odds = tierOdds(TIERED);
    expect(odds.dirt).toBeCloseTo(10);
    expect(odds.common).toBeCloseTo(60);
    expect(odds.legendary).toBeCloseTo(30);
    expect(odds.rare).toBe(0);
  });

  it("gives the chance of an empty tier to the filled tiers in proportion", () => {
    const withoutLegendary = { ...TIERED, default: TIERED.default.filter((i) => i.tier !== "legendary") };
    const odds = tierOdds(withoutLegendary);
    expect(odds.dirt).toBeCloseTo((10 / 70) * 100);
    expect(odds.common).toBeCloseTo((60 / 70) * 100);
  });

  it("does not change the odds of other tiers when entries are added to one tier", () => {
    const more = {
      ...TIERED,
      default: [...TIERED.default, ...Array.from({ length: 50 }, (_, n) => ({ item: `minecraft:wool_${n}`, amount: 1, tier: "common" as const }))],
    };
    expect(tierOdds(more).legendary).toBeCloseTo(tierOdds(TIERED).legendary);
    expect(tierOdds(more).dirt).toBeCloseTo(tierOdds(TIERED).dirt);
    const chances = itemChances(more);
    expect(chances[3]).toBeCloseTo(30);
  });

  it("gives each entry its tier chance times its share of the tier", () => {
    const chances = itemChances(TIERED);
    expect(chances[0]).toBeCloseTo(10);
    expect(chances[1]).toBeCloseTo(45);
    expect(chances[2]).toBeCloseTo(15);
    expect(chances[3]).toBeCloseTo(30);
    expect(chances.reduce((a, b) => a + b, 0)).toBeCloseTo(100);
  });

  it("reads an entry without a tier as common, so an untiered pool draws by weight", () => {
    const odds = tierOdds(POOL);
    expect(odds.common).toBeCloseTo(100);
    const chances = itemChances(POOL);
    expect(chances[0]).toBeCloseTo(25);
    expect(chances[1]).toBeCloseTo(75);
  });

  it("falls back to the entry weights when every filled tier has no chance", () => {
    const pool = { default: POOL.default, tierChances: { legendary: 100 } };
    expect(itemChances(pool)[1]).toBeCloseTo(75);
  });

  it("keeps the tier on the rolled stack", () => {
    const rolled = rollRewards(TIERED, 1, sequence(0.99, 0));
    expect(rolled.main).toEqual({ item: "minecraft:elytra", amount: 1, weight: 1, tier: "legendary" });
  });
});

describe("minimum Minecraft version", () => {
  const versioned = {
    default: [
      { item: "minecraft:bread", amount: 1, weight: 1 },
      { item: "minecraft:copper_axe", amount: 1, weight: 1, since: "1.21.9" },
    ] as DailyRewardItem[],
  };

  it("orders release numbers part by part", () => {
    expect(compareMcVersions("1.21.10", "1.21.9")).toBe(1);
    expect(compareMcVersions("26.1", "1.21.11")).toBe(1);
    expect(compareMcVersions("26.3.1", "26.3")).toBe(1);
    expect(compareMcVersions("26.3", "26.3.0")).toBe(0);
    expect(compareMcVersions("1.20.6", "1.21")).toBe(-1);
  });

  it("never rolls an entry newer than the server", () => {
    expect(itemChances(versioned, { version: "1.21.4" })).toEqual([100, 0]);
    for (let i = 0; i < 20; i++) {
      expect(drawFromPool(versioned, () => Math.random(), { version: "1.21.4" }).item).toBe("minecraft:bread");
    }
  });

  it("rolls every entry when the version is unknown or new enough", () => {
    expect(itemChances(versioned, { version: null })).toEqual([50, 50]);
    expect(itemChances(versioned, { version: "26.3" })).toEqual([50, 50]);
    expect(isAvailableOn({ since: "1.21.9" }, undefined)).toBe(true);
  });

  it("uses the whole pool rather than drawing nothing when the version leaves it empty", () => {
    const onlyNew = { default: [{ item: "minecraft:copper_axe", amount: 1, since: "1.21.9" }] as DailyRewardItem[] };
    expect(drawFromPool(onlyNew, () => 0, { version: "1.20.1" }).item).toBe("minecraft:copper_axe");
  });
});
