import { describe, it, expect } from "vitest";
import { rarityOf, rarest, milestoneDays, nextMilestone } from "@mcbot/core/utils/minecraft/rewards.js";

const pool = [
  { item: "minecraft:bread", amount: 1, weight: 60 },
  { item: "minecraft:iron_ingot", amount: 1, weight: 25 },
  { item: "minecraft:gold_ingot", amount: 1, weight: 10 },
  { item: "minecraft:diamond", amount: 1, weight: 4 },
  { item: "minecraft:netherite_ingot", amount: 1, weight: 1 },
];

describe("rarityOf", () => {
  it("ranks by weight share", () => {
    expect(rarityOf(pool[0]!, pool)).toBe("common");
    expect(rarityOf(pool[1]!, pool)).toBe("uncommon");
    expect(rarityOf(pool[2]!, pool)).toBe("rare");
    expect(rarityOf(pool[3]!, pool)).toBe("epic");
    expect(rarityOf(pool[4]!, pool)).toBe("legendary");
  });

  it("treats a flat pool as common", () => {
    const flat = pool.map((p) => ({ ...p, weight: 1 }));
    expect(rarityOf(flat[4]!, flat)).toBe("common");
  });
});

describe("rarest", () => {
  it("picks the highest tier", () => {
    expect(rarest(["common", "epic", "rare"])).toBe("epic");
    expect(rarest([])).toBe("common");
  });
});

describe("milestones", () => {
  const bonuses = { "3": [pool[0]!], "7": [pool[1]!], x: [] };
  it("lists numeric days ascending", () => {
    expect(milestoneDays(bonuses)).toEqual([3, 7]);
  });
  it("finds the next milestone after a streak", () => {
    expect(nextMilestone(3, bonuses)?.day).toBe(7);
    expect(nextMilestone(7, bonuses)).toBeNull();
    expect(nextMilestone(0, undefined)).toBeNull();
  });
});
