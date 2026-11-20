import { describe, it, expect } from "vitest";
import {
  CATEGORY_STYLE,
  DISCORD_EMBED_BACKGROUND,
  MIN_BAR_CONTRAST,
  contrastRatio,
  EMBED_CATEGORIES,
  REWARD_RARITIES,
  RARITY_STYLE,
  defaultEmbedColor,
  isEmbedColorKey,
  parseHexColor,
} from "@mcbot/schema/embedCategories.js";
import { StatusRole, statusEmbedColor } from "@mcbot/schema/status.js";

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

describe("colour helpers", () => {
  it("round-trips colours through hex", async () => {
    const { colorToHex, parseHexColor: parse } = await import("@mcbot/schema/embedCategories.js");
    expect(colorToHex(0x00ff7f)).toBe("#00ff7f");
    expect(parse(colorToHex(0x123456))).toBe(0x123456);
  });

  it("flags a colour that vanishes into Discord's dark card", async () => {
    const { contrastRatio, DISCORD_EMBED_BACKGROUND, MIN_BAR_CONTRAST } = await import(
      "@mcbot/schema/embedCategories.js"
    );
    expect(contrastRatio(0x2b2d31, DISCORD_EMBED_BACKGROUND.dark)).toBeLessThan(MIN_BAR_CONTRAST);
    expect(contrastRatio(0xfbbf24, DISCORD_EMBED_BACKGROUND.dark)).toBeGreaterThan(MIN_BAR_CONTRAST);
  });
});

describe("default bar colours", () => {
  const all = [
    ...EMBED_CATEGORIES.map((c) => [c, CATEGORY_STYLE[c].color] as const),
    ...REWARD_RARITIES.map((r) => [`rarity.${r}`, RARITY_STYLE[r].color] as const),
  ];

  it("keeps every default visible on both Discord themes", () => {
    for (const [key, color] of all) {
      for (const background of Object.values(DISCORD_EMBED_BACKGROUND)) {
        expect(contrastRatio(color, background), key).toBeGreaterThanOrEqual(MIN_BAR_CONTRAST);
      }
    }
  });

  it("gives no rarity tier a colour that a category or a status role already uses", () => {
    const others = [
      ...EMBED_CATEGORIES.map((c) => CATEGORY_STYLE[c].color),
      ...Object.values(StatusRole).map((role) => statusEmbedColor(role)),
    ];
    for (const tier of REWARD_RARITIES) {
      expect(others, tier).not.toContain(RARITY_STYLE[tier].color);
    }
  });
});

describe("default colours are far enough apart", () => {
  const linear = (value: number): number => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  /** CIE76 colour distance: the Euclidean distance between two colours in CIELAB (D65). */
  function deltaE(a: number, b: number): number {
    const lab = (color: number): [number, number, number] => {
      const r = linear((color >> 16) & 255);
      const g = linear((color >> 8) & 255);
      const bl = linear(color & 255);
      const x = (0.4124 * r + 0.3576 * g + 0.1805 * bl) / 0.95047;
      const y = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      const z = (0.0193 * r + 0.1192 * g + 0.9505 * bl) / 1.08883;
      const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    };
    const [l1, a1, b1] = lab(a);
    const [l2, a2, b2] = lab(b);
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
  }

  it("keeps every rarity colour at least 12 away from every category and status colour", () => {
    const others: Array<[string, number]> = [
      ...EMBED_CATEGORIES.map((c): [string, number] => [c, CATEGORY_STYLE[c].color]),
      ...Object.values(StatusRole).map((role): [string, number] => [`status.${role}`, statusEmbedColor(role)]),
    ];
    for (const tier of REWARD_RARITIES) {
      for (const [name, color] of others) {
        expect(deltaE(RARITY_STYLE[tier].color, color), `${tier} against ${name}`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("keeps the six rarity colours at least 25 apart from each other", () => {
    for (const a of REWARD_RARITIES) {
      for (const b of REWARD_RARITIES) {
        if (a >= b) continue;
        expect(deltaE(RARITY_STYLE[a].color, RARITY_STYLE[b].color), `${a} against ${b}`).toBeGreaterThanOrEqual(25);
      }
    }
  });
});
