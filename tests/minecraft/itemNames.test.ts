import { describe, it, expect } from "vitest";
import {
  itemDisplayName,
  formatItemStack,
  formatItemList,
} from "../../src/core/utils/minecraft/itemNames.js";

describe("itemDisplayName", () => {
  it("title-cases the id without its namespace", () => {
    expect(itemDisplayName("minecraft:cooked_beef")).toBe("Cooked Beef");
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
    ).toBe("3 × Diamond, 16 × Cooked Beef");
  });
});
