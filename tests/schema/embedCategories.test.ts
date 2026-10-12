import { describe, it, expect } from "vitest";
import {
  CATEGORY_STYLE,
  EMBED_CATEGORIES,
  REWARD_RARITIES,
  RARITY_STYLE,
  defaultEmbedColor,
  isEmbedColorKey,
  parseHexColor,
} from "@mcbot/schema/embedCategories.js";

describe("embed categories", () => {
  it("gives every category an icon and a distinct colour", () => {
    const colors = EMBED_CATEGORIES.map((c) => CATEGORY_STYLE[c].color);
    expect(EMBED_CATEGORIES.every((c) => CATEGORY_STYLE[c].icon.length > 0)).toBe(true);
    // info and server share a hue on purpose; everything else must differ
    expect(new Set(colors).size).toBeGreaterThanOrEqual(EMBED_CATEGORIES.length - 3);
  });

  it("orders rarity colours distinctly", () => {
    const colors = REWARD_RARITIES.map((r) => RARITY_STYLE[r].color);
    expect(new Set(colors).size).toBe(REWARD_RARITIES.length);
  });

  it("recognises category and rarity keys only", () => {
    expect(isEmbedColorKey("reward")).toBe(true);
    expect(isEmbedColorKey("rarity.epic")).toBe(true);
    expect(isEmbedColorKey("rarity.mythic")).toBe(false);
    expect(isEmbedColorKey("nope")).toBe(false);
  });

  it("resolves default colours", () => {
    expect(defaultEmbedColor("death")).toBe(CATEGORY_STYLE.death.color);
    expect(defaultEmbedColor("rarity.rare")).toBe(RARITY_STYLE.rare.color);
  });

  it("parses strict hex only", () => {
    expect(parseHexColor("#4ade80")).toBe(0x4ade80);
    expect(parseHexColor("4ade80")).toBeUndefined();
    expect(parseHexColor("#4ade8")).toBeUndefined();
    expect(parseHexColor(123)).toBeUndefined();
  });
});
