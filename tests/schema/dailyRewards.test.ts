import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import {
  DEFAULT_TIER_CHANCES,
  itemProblem,
  normalizedWeights,
  parseOverridePool,
  parseRewardPool,
  sharePercent,
  sinceProblem,
  tierChancesOf,
  totalWeight,
  weightForPercent,
} from "@mcbot/schema/dailyRewards.js";
import { REWARD_RARITIES } from "@mcbot/schema/embedCategories.js";
import { compareMcVersions, itemChances } from "@mcbot/schema/rewardRoll.js";
import { MINECRAFT_ITEMS } from "@mcbot/schema/minecraftItems.js";

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

describe("tiers, since and tier chances", () => {
  it("keeps a valid tier and since on pool entries", () => {
    const { pool, errors } = parseRewardPool(
      { default: [{ item: "stick", tier: "dirt", since: "1.21.4" }, { item: "bread" }] },
      "shared",
    );
    expect(errors).toEqual([]);
    expect(pool.default).toEqual([
      { item: "stick", amount: 1, tier: "dirt", since: "1.21.4" },
      { item: "bread", amount: 1 },
    ]);
  });

  it("refuses an unknown tier and a bad version, naming where", () => {
    const { pool, errors } = parseRewardPool(
      { default: [{ item: "a", tier: "mythic" }, { item: "b", since: "latest" }, { item: "c" }] },
      "shared",
    );
    expect(pool.default).toEqual([{ item: "c", amount: 1 }]);
    expect(errors.map((e) => e.split(":")[0])).toEqual(["default[0].tier", "default[1].since"]);
  });

  it("ignores tier and since in streak bonuses", () => {
    const { pool } = parseRewardPool(
      { default: [{ item: "a" }], streakBonuses: { "3": [{ item: "b", tier: "rare" }] } },
      "shared",
    );
    expect(pool.streakBonuses?.["3"]).toEqual([{ item: "b", amount: 1 }]);
  });

  it.each(["1.21", "1.21.6", "26.1", "26.3.1"])("accepts the version %s", (v) => expect(sinceProblem(v)).toBeNull());
  it.each(["", "latest", "1", "1.21.6.2", "v1.21", 26.1])("refuses the version %j", (v) =>
    expect(sinceProblem(v)).not.toBeNull(),
  );

  it("accepts tier chances that add up to 100 and fills missing tiers with 0", () => {
    const { pool, errors } = parseRewardPool(
      { default: [{ item: "a" }], tierChances: { common: 70, rare: 30 } },
      "shared",
    );
    expect(errors).toEqual([]);
    expect(tierChancesOf(pool)).toEqual({ dirt: 0, common: 70, uncommon: 0, rare: 30, epic: 0, legendary: 0 });
  });

  it("uses the defaults when a pool sets no chances, and the defaults add up to 100", () => {
    expect(tierChancesOf({})).toEqual(DEFAULT_TIER_CHANCES);
    const sum = Object.values(DEFAULT_TIER_CHANCES).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
  });

  it.each([
    [{ common: 50 }, "add up to"],
    [{ common: 120, rare: -20 }, "from 0 to 100"],
    [{ mythic: 100 }, "unknown tier"],
    [{}, "at least one"],
    [[1, 2], "map tier names"],
  ])("refuses tier chances %j", (chances, text) => {
    const { pool, errors } = parseRewardPool({ default: [{ item: "a" }], tierChances: chances }, "shared");
    expect(pool.tierChances).toBeUndefined();
    expect(errors.join("\n")).toContain(text);
  });

  it("reads tier chances, tier and since in a server override", () => {
    const { pool, errors } = parseOverridePool({
      tierChances: { common: 100 },
      default: { set: { a: { item: "stick", tier: "dirt", since: "1.20.5" } } },
    });
    expect(errors).toEqual([]);
    expect(pool.tierChances).toEqual({ common: 100 });
    expect(pool.default?.set?.["a"]).toEqual({ item: "stick", tier: "dirt", since: "1.20.5" });
  });
});

describe("shipped default pool", () => {
  const file = path.resolve(__dirname, "../../data/dailyRewards.defaults.json");
  const { pool, errors } = parseRewardPool(JSON.parse(readFileSync(file, "utf8")), "shared");
  const items = pool.default ?? [];
  const byTier = (tier: string) => items.filter((i) => i.tier === tier);

  it("has no problems and gives every entry a tier", () => {
    expect(errors).toEqual([]);
    expect(items.every((i) => i.tier !== undefined)).toBe(true);
  });

  it("fills every tier and sets chances that add up to 100", () => {
    for (const tier of REWARD_RARITIES) expect(byTier(tier).length).toBeGreaterThan(0);
    const sum = Object.values(tierChancesOf(pool)).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(100, 6);
    expect(pool.tierChances).toEqual(DEFAULT_TIER_CHANCES);
  });

  it("never lists the same item with the same amount twice", () => {
    const keys = items.map((i) => `${i.item}|${i.amount}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the dirt tier to single items of equal weight", () => {
    const dirt = byTier("dirt");
    expect(dirt.every((i) => i.amount === 1 && (i.weight ?? 1) === 1)).toBe(true);
  });

  it("keeps every progression skip in the legendary tier", () => {
    const skips = [
      "elytra",
      "nether_star",
      "totem_of_undying",
      "conduit",
      "dragon_egg",
      "heavy_core",
      "netherite_upgrade_smithing_template",
    ];
    for (const id of skips) {
      expect(items.filter((i) => i.item === id).map((i) => i.tier)).toEqual(["legendary"]);
    }
  });

  it("rolls no entry newer than the server and still adds up to 100", () => {
    const chances = itemChances({ default: items, tierChances: pool.tierChances }, { version: "1.20.1" });
    expect(chances.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    items.forEach((i, n) => {
      if (i.since && compareMcVersions("1.20.1", i.since) < 0) expect(chances[n]).toBe(0);
    });
  });
});

describe("shipped default pool amounts", () => {
  const poolFile = path.resolve(__dirname, "../../data/dailyRewards.defaults.json");
  const { pool } = parseRewardPool(JSON.parse(readFileSync(poolFile, "utf8")), "shared");
  const items = pool.default ?? [];
  const catalog = new Set(MINECRAFT_ITEMS.map((row) => row[0]));
  const tierIndex = (tier: string | undefined) => REWARD_RARITIES.indexOf((tier ?? "common") as (typeof REWARD_RARITIES)[number]);
  const byItem = new Map<string, typeof items>();
  for (const entry of items) byItem.set(entry.item, [...(byItem.get(entry.item) ?? []), entry]);

  it("uses only item ids the vanilla catalog knows", () => {
    expect([...byItem.keys()].filter((id) => !catalog.has(id))).toEqual([]);
  });

  it("has one entry per tier for an item, and a bigger amount in a higher tier", () => {
    for (const [item, list] of byItem) {
      const tiers = list.map((e) => e.tier);
      expect(new Set(tiers).size, `${item} twice in one tier`).toBe(tiers.length);
      const sorted = [...list].sort((a, b) => tierIndex(a.tier) - tierIndex(b.tier));
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i]!.amount, `${item} ${sorted[i]!.tier}`).toBeGreaterThan(sorted[i - 1]!.amount);
      }
    }
  });

  it("ladders a staple item from 16 in common to 128 in epic", () => {
    const amounts = (id: string) =>
      Object.fromEntries((byItem.get(id) ?? []).map((e) => [e.tier, e.amount]));
    expect(amounts("oak_log")).toEqual({ common: 16, uncommon: 32, rare: 64, epic: 128 });
    expect(amounts("iron_ingot")).toEqual({ common: 4, uncommon: 8, rare: 16, epic: 32 });
    expect(amounts("diamond")).toEqual({ rare: 2, epic: 4, legendary: 8 });
  });

  it("keeps amounts small in the low tiers and the legendary tier", () => {
    const max = (tier: string) => Math.max(...items.filter((e) => e.tier === tier).map((e) => e.amount));
    expect(max("dirt")).toBe(1);
    expect(max("common")).toBeLessThanOrEqual(16);
    expect(max("uncommon")).toBeLessThanOrEqual(32);
    expect(max("rare")).toBeLessThanOrEqual(64);
    expect(max("epic")).toBeLessThanOrEqual(128);
    expect(max("legendary")).toBeLessThanOrEqual(8);
  });

  it("fills every tier with a real choice of items", () => {
    for (const tier of REWARD_RARITIES) {
      const count = items.filter((e) => e.tier === tier).length;
      expect(count, tier).toBeGreaterThanOrEqual(tier === "legendary" ? 20 : 24);
    }
  });

  it("never adds netherite, beacons or mending-style progression items below the legendary tier", () => {
    const banned = ["netherite_ingot", "netherite_block", "beacon", "ancient_debris", "shulker_shell"];
    for (const id of banned) {
      for (const entry of byItem.get(id) ?? []) expect(["epic", "legendary"], `${id} in ${entry.tier}`).toContain(entry.tier);
    }
  });
});
