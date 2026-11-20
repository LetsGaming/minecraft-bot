import { describe, it, expect, vi, beforeEach } from "vitest";

const language = vi.hoisted(() => ({ current: "en" as "en" | "de" }));
vi.mock("../../src/core/utils/i18n.js", () => ({
  resolveLanguage: () => language.current,
}));

import { MINECRAFT_ITEMS } from "@mcbot/schema/minecraftItems.js";
import { ITEM_NAMES_DE } from "../../src/core/utils/minecraft/itemNamesDe.js";
import {
  formatItemList,
  formatItemStack,
  humanizeId,
  itemDisplayName,
} from "../../src/core/utils/minecraft/itemNames.js";

beforeEach(() => {
  language.current = "en";
});

describe("itemDisplayName in English", () => {
  it("uses the game's name for a vanilla item", () => {
    expect(itemDisplayName("cooked_beef")).toBe("Steak");
    expect(itemDisplayName("minecraft:ender_eye")).toBe("Eye of Ender");
    expect(itemDisplayName("redstone")).toBe("Redstone Dust");
    expect(itemDisplayName("diamond_block")).toBe("Block of Diamond");
    expect(itemDisplayName("heart_of_the_sea")).toBe("Heart of the Sea");
  });

  it("keeps the id-built name where the game name drops what tells items apart", () => {
    expect(itemDisplayName("music_disc_pigstep")).toBe("Music Disc Pigstep");
    expect(itemDisplayName("disc_fragment_5")).toBe("Disc Fragment 5");
    expect(itemDisplayName("bolt_armor_trim_smithing_template")).toBe("Bolt Armor Trim Smithing Template");
    expect(itemDisplayName("netherite_upgrade_smithing_template")).toBe("Netherite Upgrade Smithing Template");
  });

  it("ignores a components suffix and a namespace of a vanilla item", () => {
    expect(itemDisplayName("minecraft:diamond_sword[minecraft:damage=5]")).toBe("Diamond Sword");
  });

  it("builds the name of a modded or unknown id from the id", () => {
    expect(itemDisplayName("create:brass_ingot")).toBe("Brass Ingot");
    expect(itemDisplayName("zzz_unknown")).toBe("Zzz Unknown");
    expect(itemDisplayName("")).toBe("???");
  });

  it("gives every item of the vanilla list a name", () => {
    for (const [id] of MINECRAFT_ITEMS) expect(itemDisplayName(id)).not.toBe("???");
  });
});

describe("itemDisplayName in German", () => {
  beforeEach(() => {
    language.current = "de";
  });

  it("uses a drafted German name", () => {
    expect(itemDisplayName("oak_log")).toBe("Eichenstamm");
    expect(itemDisplayName("minecraft:diamond_block")).toBe("Diamantblock");
    expect(itemDisplayName("experience_bottle")).toBe("Erfahrungsfläschchen");
  });

  it("declines a color by the gender of the noun", () => {
    expect(itemDisplayName("white_wool")).toBe("Weiße Wolle");
    expect(itemDisplayName("orange_concrete")).toBe("Orangefarbener Beton");
    expect(itemDisplayName("light_blue_stained_glass")).toBe("Hellblaues Buntglas");
    expect(itemDisplayName("pink_terracotta")).toBe("Rosa Terrakotta");
    expect(itemDisplayName("cyan_glazed_terracotta")).toBe("Türkise glasierte Terrakotta");
  });

  it("names music discs and disc fragments", () => {
    expect(itemDisplayName("music_disc_pigstep")).toBe("Schallplatte Pigstep");
    expect(itemDisplayName("disc_fragment_5")).toBe("Plattenfragment 5");
  });

  it("falls back to English where no German name is drafted, and for modded ids", () => {
    expect(itemDisplayName("angler_pottery_sherd")).toBe("Angler Pottery Sherd");
    expect(itemDisplayName("create:brass_ingot")).toBe("Brass Ingot");
  });

  it("only names ids the vanilla list knows", () => {
    const known = new Set(MINECRAFT_ITEMS.map(([id]) => id));
    expect(Object.keys(ITEM_NAMES_DE).filter((id) => !known.has(id))).toEqual([]);
  });
});

describe("formatting", () => {
  it("formats a stack and a list with the game's names", () => {
    expect(formatItemStack({ item: "cooked_beef", amount: 16 })).toBe("16 × Steak");
    expect(
      formatItemList([
        { item: "diamond", amount: 3 },
        { item: "cooked_beef", amount: 16 },
      ]),
    ).toBe("3 × Diamond, 16 × Steak");
  });

  it("still builds a stat key name from the id alone, in every language", () => {
    expect(humanizeId("minecraft:mined/deepslate")).toBe("Mined/Deepslate");
    expect(humanizeId("minecraft:cooked_beef")).toBe("Cooked Beef");
  });
});
