import { describe, it, expect } from "vitest";
import { DEFAULT_MAX_STREAK, deriveMaxStreak, pick, rollRewards } from "@mcbot/schema/rewardRoll.js";

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

  it("draws in the order main, chance roll, bonus", () => {
    const rolled = rollRewards({ ...POOL, bonusChance: 50 }, 3, sequence(0, 0.1, 0.9));
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
    expect(calls).toHaveLength(1);
    expect(rollRewards({ ...POOL, bonusChance: 10 }, 1, sequence(0, 0.99)).randomBonus).toBeNull();
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
