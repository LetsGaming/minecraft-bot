import { describe, it, expect } from "vitest";
import {
  assignIds,
  entryIds,
  parseOverridePool,
  parseRewardPool,
  isLegacyOverride,
  type OverridePool,
  type RewardPool,
} from "@mcbot/schema/dailyRewards.js";
import {
  compactOverride,
  convertLegacyOverride,
  detachEntries,
  diffShared,
  excludeEntries,
  reattachEntry,
  resolvePool,
  samePool,
  serverImpact,
  summarizeChanges,
} from "@mcbot/schema/rewardPatch.js";

const SHARED: RewardPool = {
  default: [
    { id: "d1", item: "minecraft:dirt", amount: 16, weight: 20 },
    { id: "dia1", item: "minecraft:diamond", amount: 1, weight: 10 },
    { id: "dia64", item: "minecraft:diamond", amount: 64, weight: 1 },
    { id: "ns", item: "minecraft:netherite_ingot", amount: 64, weight: 0.01 },
  ],
  streakBonuses: {
    "3": [{ id: "b1", item: "minecraft:bread", amount: 8 }],
    "14": [
      { id: "g1", item: "minecraft:golden_apple", amount: 2 },
      { id: "e1", item: "minecraft:emerald", amount: 5 },
    ],
  },
  bonusChance: 5,
};

const ids = (list: Array<{ id?: string }> | undefined): Array<string | undefined> => (list ?? []).map((e) => e.id);

describe("entry ids", () => {
  it("derives stable ids for duplicate item strings without storing anything", () => {
    const list = [
      { item: "minecraft:diamond", amount: 1 },
      { item: "minecraft:diamond", amount: 64 },
      { item: "minecraft:dirt", amount: 1 },
    ];
    const derived = entryIds(list);
    expect(new Set(derived).size).toBe(3);
    expect(entryIds(list)).toEqual(derived);
    expect(assignIds(list).map((e) => e.id)).toEqual(derived);
  });

  it("keeps explicit ids and never repeats one", () => {
    const list = [
      { item: "minecraft:diamond", amount: 1, id: "x" },
      { item: "minecraft:diamond", amount: 2 },
      { item: "minecraft:diamond", amount: 3 },
    ];
    const out = entryIds(list);
    expect(out[0]).toBe("x");
    expect(new Set(out).size).toBe(3);
  });

  it("accepts a pool with the same item twice and keeps the ids", () => {
    const { pool, errors } = parseRewardPool(SHARED, "shared");
    expect(errors).toEqual([]);
    expect(ids(pool.default)).toEqual(["d1", "dia1", "dia64", "ns"]);
  });

  it("refuses an id used twice in one list", () => {
    const { errors } = parseRewardPool(
      { default: [{ item: "a", amount: 1, id: "x" }, { item: "b", amount: 1, id: "x" }] },
      "shared",
    );
    expect(errors.join()).toContain("used twice");
  });
});

describe("parseOverridePool", () => {
  it("reads the patch form", () => {
    const raw = {
      default: { add: [{ id: "n1", item: "minecraft:apple", amount: 2, weight: 3 }], remove: ["d1"], set: { dia1: { item: "minecraft:diamond", weight: 4 } } },
      streakBonuses: { removeDays: ["3"], days: { "14": { remove: ["e1"] } } },
      bonusChance: 8,
    };
    const { pool, errors } = parseOverridePool(raw);
    expect(errors).toEqual([]);
    expect(pool).toEqual(raw);
    expect(isLegacyOverride(raw)).toBe(false);
  });

  it("needs an id on an added entry and rejects unknown fields", () => {
    const { errors } = parseOverridePool({ default: { add: [{ item: "minecraft:apple", amount: 1 }], keep: [] } });
    expect(errors.join()).toContain("needs an id");
    expect(errors.join()).toContain("unknown field");
  });

  it("recognises the old whole-field form", () => {
    expect(isLegacyOverride({ default: [{ item: "a", amount: 1 }] })).toBe(true);
    expect(isLegacyOverride({ streakBonuses: { "3": [{ item: "a", amount: 1 }] } })).toBe(true);
    expect(isLegacyOverride({ bonusChance: 3 })).toBe(false);
  });
});

describe("resolvePool", () => {
  it("inherits everything for an empty override", () => {
    const { pool, problems } = resolvePool(SHARED, {});
    expect(problems).toEqual([]);
    expect(samePool(pool, SHARED)).toBe(true);
  });

  it("removes one of two same-named entries and leaves the other", () => {
    const { pool } = resolvePool(SHARED, { default: { remove: ["dia64"] } });
    expect(ids(pool.default)).toEqual(["d1", "dia1", "ns"]);
  });

  it("sets only the named fields and adds local entries", () => {
    const override: OverridePool = {
      default: {
        set: { dia1: { item: "minecraft:diamond", weight: 99 } },
        add: [{ id: "mine", item: "minecraft:apple", amount: 3, weight: 2 }],
      },
      bonusChance: 0,
    };
    const { pool } = resolvePool(SHARED, override);
    expect(pool.default!.find((e) => e.id === "dia1")).toMatchObject({ amount: 1, weight: 99 });
    expect(pool.default!.at(-1)).toMatchObject({ item: "minecraft:apple", amount: 3 });
    expect(pool.bonusChance).toBe(0);
  });

  it("patches streak days, removes days and adds new ones", () => {
    const { pool } = resolvePool(SHARED, {
      streakBonuses: {
        removeDays: ["3"],
        days: {
          "14": { remove: ["e1"], set: { g1: { item: "minecraft:golden_apple", amount: 4 } } },
          "20": { add: [{ id: "n", item: "minecraft:cake", amount: 1 }] },
        },
      },
    });
    expect(Object.keys(pool.streakBonuses!)).toEqual(["14", "20"]);
    expect(pool.streakBonuses!["14"]).toMatchObject([{ id: "g1", amount: 4 }]);
  });

  it("reports an orphaned set but drops an orphaned remove quietly in the result", () => {
    const { pool, orphans } = resolvePool(SHARED, {
      default: { remove: ["gone"], set: { missing: { item: "minecraft:gold_ingot", weight: 2 } } },
    });
    expect(pool.default).toHaveLength(4);
    expect(orphans).toEqual([
      { where: "default", kind: "remove", id: "gone" },
      { where: "default", kind: "set", id: "missing", item: "minecraft:gold_ingot" },
    ]);
  });

  it("flags an item pool or a day with nothing left", () => {
    const empty = resolvePool(SHARED, { default: { remove: ["d1", "dia1", "dia64", "ns"] } });
    expect(empty.problems.join()).toContain("no items left");
    const day = resolvePool(SHARED, { streakBonuses: { days: { "3": { remove: ["b1"] } } } });
    expect(day.problems.join()).toContain("streakBonuses.3");
    expect(day.pool.streakBonuses).not.toHaveProperty("3");
  });
});

describe("convertLegacyOverride", () => {
  function roundTrips(shared: RewardPool, legacy: RewardPool): OverridePool {
    const patch = convertLegacyOverride(shared, legacy);
    const { pool } = resolvePool(shared, patch);
    const expected: RewardPool = {
      default: legacy.default ?? shared.default,
      streakBonuses: legacy.streakBonuses ?? shared.streakBonuses,
      bonusChance: legacy.bonusChance ?? shared.bonusChance,
    };
    expect(samePool(pool, expected)).toBe(true);
    return patch;
  }

  it("turns an exact copy into no patch, so the server follows shared from now on", () => {
    const patch = roundTrips(SHARED, SHARED);
    expect(compactOverride(patch)).toEqual({});
  });

  it("expresses extra and missing entries, including duplicates with other weights", () => {
    const legacy: RewardPool = {
      default: [
        { item: "minecraft:dirt", amount: 16, weight: 20 },
        { item: "minecraft:diamond", amount: 1, weight: 30 },
        { item: "minecraft:diamond", amount: 64, weight: 1 },
        { item: "minecraft:apple", amount: 4, weight: 2 },
        { item: "minecraft:apple", amount: 8, weight: 1 },
      ],
    };
    const patch = roundTrips(SHARED, legacy);
    expect(patch.default?.remove).toEqual(["ns"]);
    expect(patch.default?.set).toEqual({ dia1: { item: "minecraft:diamond", weight: 30 } });
    expect(patch.default?.add).toHaveLength(2);
    expect(new Set(ids(patch.default?.add)).size).toBe(2);
  });

  it("converts streak days: changed, dropped and new", () => {
    const legacy: RewardPool = {
      streakBonuses: {
        "14": [{ item: "minecraft:golden_apple", amount: 2 }, { item: "minecraft:diamond", amount: 1 }],
        "30": [{ item: "minecraft:cake", amount: 1 }],
      },
    };
    const patch = roundTrips(SHARED, legacy);
    expect(patch.streakBonuses?.removeDays).toEqual(["3"]);
    expect(patch.streakBonuses?.days?.["14"]?.remove).toEqual(["e1"]);
    expect(patch.streakBonuses?.days?.["30"]?.add).toHaveLength(1);
  });

  it("keeps a bonus chance that differs and drops one equal to shared", () => {
    expect(convertLegacyOverride(SHARED, { bonusChance: 9 }).bonusChance).toBe(9);
    expect(convertLegacyOverride(SHARED, { bonusChance: 5 }).bonusChance).toBeUndefined();
  });

  it("works against a shared pool that has no stored ids yet", () => {
    const bare: RewardPool = { default: SHARED.default!.map(({ id: _id, ...rest }) => rest) };
    const legacy: RewardPool = { default: bare.default!.slice(1) };
    const patch = roundTrips(bare, legacy);
    expect(patch.default?.remove).toEqual([entryIds(bare.default)[0]]);
    // The same patch still resolves after the dashboard stores the derived ids.
    const stored: RewardPool = { default: assignIds(bare.default!) };
    expect(samePool(resolvePool(stored, patch).pool, legacy)).toBe(true);
  });
});

describe("shared edits and servers", () => {
  const removedNetherite: RewardPool = { ...SHARED, default: SHARED.default!.filter((e) => e.id !== "ns") };

  it("lists what changed in the shared document", () => {
    const changed: RewardPool = {
      ...SHARED,
      default: [...SHARED.default!.map((e) => (e.id === "d1" ? { ...e, weight: 5 } : e)), { id: "new", item: "minecraft:apple", amount: 1, weight: 1 }],
    };
    expect(diffShared(SHARED, changed).map((c) => `${c.kind}:${c.id}`)).toEqual(["changed:d1", "added:new"]);
  });

  it("tells a server that inherits a removal about it", () => {
    const { changes } = serverImpact(SHARED, removedNetherite, undefined);
    expect(changes).toMatchObject([{ kind: "removed", id: "ns" }]);
  });

  it("does not bother a server that already removed the entry or kept a copy of it", () => {
    expect(serverImpact(SHARED, removedNetherite, { default: { remove: ["ns"] } }).changes).toEqual([]);
    const kept = detachEntries(SHARED.default, undefined, ["ns"], true);
    expect(serverImpact(SHARED, removedNetherite, { default: kept }).changes).toEqual([]);
  });

  it("treats a pinned value as unaffected by a change to that value", () => {
    const heavier: RewardPool = { ...SHARED, default: SHARED.default!.map((e) => (e.id === "ns" ? { ...e, weight: 5 } : e)) };
    const pinned: OverridePool = { default: { set: { ns: { item: "minecraft:netherite_ingot", weight: 0.01 } } } };
    expect(serverImpact(SHARED, heavier, pinned).changes).toEqual([]);
    expect(serverImpact(SHARED, heavier, undefined).changes).toHaveLength(1);
  });

  it("reports a customised entry that shared deletes as an orphan", () => {
    const pinned: OverridePool = { default: { set: { ns: { item: "minecraft:netherite_ingot", weight: 0.5 } } } };
    const { orphans } = serverImpact(SHARED, removedNetherite, pinned);
    expect(orphans).toEqual([{ where: "default", kind: "set", id: "ns", item: "minecraft:netherite_ingot" }]);
  });

  it("detaching keeps the server's resolved pool when shared later drops the entry", () => {
    const kept = detachEntries(SHARED.default, { set: { ns: { item: "minecraft:netherite_ingot", weight: 0.5 } } }, ["ns"], true)!;
    const before = resolvePool(SHARED, { default: kept }).pool.default!;
    const after = resolvePool(removedNetherite, { default: kept }).pool.default!;
    expect(after.find((e) => e.item === "minecraft:netherite_ingot")).toMatchObject({ amount: 64, weight: 0.5, detachedFrom: "ns" });
    expect(samePool({ default: before }, { default: after })).toBe(true);
  });

  it("reattaching removes the copy and lets the shared entry through", () => {
    const kept = detachEntries(SHARED.default, undefined, ["ns"], true);
    const copyId = kept!.add![0]!.id!;
    expect(reattachEntry(kept, copyId)).toBeUndefined();
  });

  it("excluding an added entry removes it for that server only", () => {
    const patch = excludeEntries(undefined, ["new"]);
    expect(patch).toEqual({ remove: ["new"] });
    expect(excludeEntries(patch, ["new", "other"])).toEqual({ remove: ["new", "other"] });
  });
});

describe("summarizeChanges", () => {
  it("counts items, days and the bonus chance", () => {
    const after: RewardPool = {
      default: [...SHARED.default!.slice(1), { id: "new", item: "minecraft:apple", amount: 1 }],
      streakBonuses: { "14": [{ id: "g1", item: "minecraft:golden_apple", amount: 3 }], "20": [{ id: "c", item: "minecraft:cake", amount: 1 }] },
      bonusChance: 7,
    };
    expect(summarizeChanges(SHARED, after)).toEqual({
      items: { added: 1, removed: 1, changed: 0 },
      dayItems: { added: 0, removed: 1, changed: 1 },
      daysAdded: 1,
      daysRemoved: 1,
      bonusChanged: true,
    });
  });
});
