import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/config.js", () => ({
  loadConfig: vi.fn().mockReturnValue({ language: "en", guilds: {} }),
  getServerIds: vi.fn().mockReturnValue([]),
}));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  heroBlock,
  historyEntry,
  itemBullets,
  itemWithTier,
  stackHint,
  tierLine,
  tierMeter,
} from "../../src/bot/utils/embeds/itemBlocks.js";
import { vanillaStackSize } from "../../src/core/utils/minecraft/itemNames.js";

describe("tierMeter", () => {
  it("fills one slot per step from common to legendary, and none for dirt", () => {
    expect(tierMeter("dirt")).toBe("◇◇◇◇◇");
    expect(tierMeter("common")).toBe("◆◇◇◇◇");
    expect(tierMeter("rare")).toBe("◆◆◆◇◇");
    expect(tierMeter("epic")).toBe("◆◆◆◆◇");
    expect(tierMeter("legendary")).toBe("◆◆◆◆◆");
  });
});

describe("vanillaStackSize", () => {
  it("reads the stack size of a vanilla item, with or without namespace and components", () => {
    expect(vanillaStackSize("oak_log")).toBe(64);
    expect(vanillaStackSize("minecraft:oak_log")).toBe(64);
    expect(vanillaStackSize("minecraft:oak_log[minecraft:custom_name='x']")).toBe(64);
    expect(vanillaStackSize("ender_pearl")).toBe(16);
    expect(vanillaStackSize("diamond_sword")).toBe(1);
  });

  it("returns null for a modded or unknown id", () => {
    expect(vanillaStackSize("create:brass_ingot")).toBeNull();
    expect(vanillaStackSize("not_an_item")).toBeNull();
  });
});

describe("stackHint", () => {
  it("counts whole stacks of an item that stacks to 64", () => {
    expect(stackHint({ item: "oak_log", amount: 128 })).toBe("2 stacks");
    expect(stackHint({ item: "oak_log", amount: 64 })).toBe("1 stack");
  });

  it("adds the remainder after the stacks", () => {
    expect(stackHint({ item: "cobblestone", amount: 84 })).toBe("1 stack + 20");
    expect(stackHint({ item: "cobblestone", amount: 130 })).toBe("2 stacks + 2");
  });

  it("gives no hint below one stack, for other stack sizes, or for ids it cannot size", () => {
    expect(stackHint({ item: "oak_log", amount: 16 })).toBeNull();
    expect(stackHint({ item: "ender_pearl", amount: 64 })).toBeNull();
    expect(stackHint({ item: "diamond_sword", amount: 64 })).toBeNull();
    expect(stackHint({ item: "create:brass_ingot", amount: 128 })).toBeNull();
  });
});

describe("tierLine and heroBlock", () => {
  it("shows tier, rank, meter and the stack hint on one subtext line", () => {
    expect(tierLine({ item: "oak_log", amount: 128, tier: "epic" })).toBe("-# 🟣 EPIC · 4/5  ◆◆◆◆◇ · 2 stacks");
  });

  it("reads an entry without a tier as common", () => {
    expect(tierLine({ item: "diamond", amount: 3 })).toBe("-# ⚪ COMMON · 1/5  ◆◇◇◇◇");
  });

  it("gives dirt an empty meter", () => {
    expect(tierLine({ item: "stick", amount: 1, tier: "dirt" })).toBe("-# 🟤 DIRT · 0/5  ◇◇◇◇◇");
  });

  it("puts the item in a header with the tier line under it", () => {
    expect(heroBlock({ item: "oak_log", amount: 128, tier: "epic" })).toEqual([
      "## 128 × Oak Log",
      "-# 🟣 EPIC · 4/5  ◆◆◆◆◇ · 2 stacks",
    ]);
  });
});

describe("itemBullets and itemWithTier", () => {
  it("lists one item per line", () => {
    expect(
      itemBullets([
        { item: "diamond_block", amount: 2 },
        { item: "experience_bottle", amount: 64 },
      ]),
    ).toBe("- 2 × Block of Diamond\n- 64 × Bottle o' Enchanting");
  });

  it("puts the tier icon in front of a tiered item only", () => {
    expect(itemWithTier({ item: "oak_log", amount: 128, tier: "epic" })).toBe("🟣 128 × Oak Log");
    expect(itemWithTier({ item: "cooked_beef", amount: 16 })).toBe("16 × Steak");
  });
});

describe("historyEntry", () => {
  it("puts the main reward first and the lucky bonus and milestone items on a second line", () => {
    expect(
      historyEntry([
        { item: "oak_log", amount: 128, tier: "epic" },
        { item: "iron_ingot", amount: 4, tier: "common" },
        { item: "cooked_beef", amount: 16 },
        { item: "diamond_block", amount: 2 },
      ]),
    ).toEqual({
      main: "🟣 128 × Oak Log",
      extras: "↳ 🍀 ⚪ 4 × Iron Ingot · 🎉 16 × Steak · 🎉 2 × Block of Diamond",
    });
  });

  it("shows a lucky bonus without a milestone, and a milestone without a lucky bonus", () => {
    expect(
      historyEntry([
        { item: "oak_log", amount: 64, tier: "rare" },
        { item: "iron_ingot", amount: 4, tier: "common" },
      ]).extras,
    ).toBe("↳ 🍀 ⚪ 4 × Iron Ingot");
    expect(
      historyEntry([
        { item: "oak_log", amount: 64, tier: "rare" },
        { item: "cooked_beef", amount: 16 },
      ]).extras,
    ).toBe("↳ 🎉 16 × Steak");
  });

  it("has no second line for a claim with only a main reward", () => {
    expect(historyEntry([{ item: "oak_log", amount: 64, tier: "rare" }])).toEqual({
      main: "🔵 64 × Oak Log",
      extras: null,
    });
  });

  it("keeps a claim from before tiers as one plain list", () => {
    expect(
      historyEntry([
        { item: "diamond", amount: 3 },
        { item: "cooked_beef", amount: 16 },
      ]),
    ).toEqual({ main: "3 × Diamond, 16 × Steak", extras: null });
    expect(historyEntry([])).toEqual({ main: "", extras: null });
  });
});
