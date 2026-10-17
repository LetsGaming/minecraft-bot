import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  itemProblem,
  normalizedWeights,
  parseRewardPool,
  sharePercent,
  totalWeight,
  weightForPercent,
} from "@mcbot/schema/dailyRewards.js";

describe("itemProblem", () => {
  it.each(["diamond", "minecraft:diamond", "create:brass_ingot", "minecraft:diamond_sword[minecraft:damage=5]", 'stone{display:{Name:"x"}}'])(
    "accepts %s",
    (item) => expect(itemProblem(item)).toBeNull(),
  );

  it.each(["", "Golden Apple", "diamond 64", "diamond\nop someone", "DIAMOND", "diamond[unclosed"])(
    "refuses %j",
    (item) => expect(itemProblem(item)).not.toBeNull(),
  );
});

describe("parseRewardPool", () => {
  it("passes a valid shared pool through and fills a missing amount", () => {
    const { pool, errors } = parseRewardPool(
      {
        default: [{ item: "diamond", weight: 2 }, { item: "stone", amount: 64 }],
        streakBonuses: { "7": [{ item: "emerald", amount: 3 }] },
        bonusChance: 5,
      },
      "shared",
    );
    expect(errors).toEqual([]);
    expect(pool.default).toEqual([{ item: "diamond", amount: 1, weight: 2 }, { item: "stone", amount: 64 }]);
    expect(pool.streakBonuses?.["7"]).toEqual([{ item: "emerald", amount: 3 }]);
    expect(pool.bonusChance).toBe(5);
  });

  it("requires the item pool in the shared document, not in an override", () => {
    expect(parseRewardPool({}, "shared").errors).toContain("default: the shared item pool is required");
    expect(parseRewardPool({ bonusChance: 1 }, "override").errors).toEqual([]);
  });

  it("drops bad entries, keeps good ones, and names where each problem is", () => {
    const { pool, errors } = parseRewardPool(
      {
        default: [
          { item: "diamond" },
          { item: "bad id" },
          { item: "stone", amount: 0 },
          { item: "dirt", weight: -1 },
        ],
      },
      "shared",
    );
    expect(pool.default).toEqual([{ item: "diamond", amount: 1 }]);
    expect(errors.map((e) => e.split(":")[0])).toEqual(["default[1].item", "default[2].amount", "default[3].weight"]);
  });

  it("refuses the removed inline servers block with a pointer to the override file", () => {
    const { errors } = parseRewardPool({ default: [{ item: "a" }], servers: { smp: {} } }, "shared");
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/dailyRewards_<serverId>\.json/);
  });

  it("refuses empty lists, bad days and an out-of-range bonus chance", () => {
    const { errors } = parseRewardPool(
      { default: [], streakBonuses: { "0": [{ item: "a" }], "3": [] }, bonusChance: 101 },
      "override",
    );
    expect(errors).toHaveLength(4);
  });

  it("accepts the shipped defaults without a single problem", () => {
    const file = path.resolve(__dirname, "../../data/dailyRewards.defaults.json");
    expect(parseRewardPool(JSON.parse(readFileSync(file, "utf-8")), "shared").errors).toEqual([]);
  });
});

describe("weights and percentages", () => {
  const pool = [{ weight: 10 }, { weight: 30 }, { weight: 60 }];

  it("gives an item the asked percentage and leaves the others' proportions alone", () => {
    const others = totalWeight(pool) - 10;
    const w = weightForPercent(25, others)!;
    const next = [{ weight: w }, pool[1]!, pool[2]!];
    expect(sharePercent(w, totalWeight(next))).toBeCloseTo(25, 3);
    // 30:60 stays 1:2
    expect(next[2]!.weight / next[1]!.weight).toBe(2);
  });

  it("has nothing to share with in a pool of one", () => {
    expect(weightForPercent(50, 0)).toBeNull();
  });

  it("normalizes weights to 100 without changing any chance", () => {
    expect(normalizedWeights(pool)).toEqual([10, 30, 60]);
    expect(normalizedWeights([{ weight: 1 }, { weight: 3 }])).toEqual([25, 75]);
    expect(normalizedWeights([{}, {}])).toEqual([50, 50]);
  });
});
