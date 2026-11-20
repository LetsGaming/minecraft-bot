import { describe, it, expect } from "vitest";
import {
  itemDisplayName,
  formatItemStack,
  formatItemList,
} from "../../src/core/utils/minecraft/itemNames.js";

describe("itemDisplayName", () => {
  it("names a vanilla item as the game does and a modded id from the id", () => {
    expect(itemDisplayName("minecraft:cooked_beef")).toBe("Steak");
    expect(itemDisplayName("diamond")).toBe("Diamond");
    expect(itemDisplayName("create:brass_ingot")).toBe("Brass Ingot");
  });

  it("falls back for an empty id", () => {
    expect(itemDisplayName("")).toBe("???");
    expect(itemDisplayName("minecraft:")).toBe("???");
  });
});

describe("formatItemStack and formatItemList", () => {
  it("renders amount and name", () => {
    expect(formatItemStack({ item: "minecraft:diamond", amount: 3 })).toBe("3 × Diamond");
    expect(
      formatItemList([
        { item: "minecraft:diamond", amount: 3 },
        { item: "cooked_beef", amount: 16 },
      ]),
    ).toBe("3 × Diamond, 16 × Steak");
  });
});
