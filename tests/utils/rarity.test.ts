import { describe, it, expect } from "vitest";
import { rarityOf, rarest, milestoneDays, nextMilestone } from "@mcbot/core/utils/minecraft/rewards.js";
import { REWARD_RARITIES } from "@mcbot/schema/embedCategories.js";

const pool = [
  { item: "minecraft:stick", amount: 1, tier: "dirt" as const },
  { item: "minecraft:bread", amount: 1 },
  { item: "minecraft:iron_ingot", amount: 1, tier: "uncommon" as const },
  { item: "minecraft:gold_ingot", amount: 1, tier: "rare" as const },
  { item: "minecraft:diamond", amount: 1, tier: "epic" as const },
  { item: "minecraft:netherite_ingot", amount: 1, tier: "legendary" as const },
];

describe("rarityOf", () => {
  it("reads the stored tier", () => {
    expect(rarityOf(pool[0]!)).toBe("dirt");
    expect(rarityOf(pool[2]!)).toBe("uncommon");
    expect(rarityOf(pool[3]!)).toBe("rare");
    expect(rarityOf(pool[4]!)).toBe("epic");
    expect(rarityOf(pool[5]!)).toBe("legendary");
  });

  it("reads an entry without a tier as common", () => {
    expect(rarityOf(pool[1]!)).toBe("common");
  });

  it("orders the tiers from dirt to legendary", () => {
    expect(REWARD_RARITIES).toEqual(["dirt", "common", "uncommon", "rare", "epic", "legendary"]);
  });
});

describe("rarest", () => {
  it("picks the highest tier", () => {
    expect(rarest(["common", "epic", "rare"])).toBe("epic");
  });

  it("ranks dirt below common", () => {
    expect(rarest(["dirt", "common"])).toBe("common");
    expect(rarest(["dirt"])).toBe("dirt");
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
