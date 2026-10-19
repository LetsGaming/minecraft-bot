import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  LEADERBOARD_STATS,
  formatRankLine,
  humanizeKey,
} from "../../src/core/utils/minecraft/statUtils.js";
import { humanizeId, itemDisplayName } from "../../src/core/utils/minecraft/itemNames.js";
import { STREAK_STAT_LABELS } from "../../src/core/utils/minecraft/streakLeaderboard.js";
import { ledgerAllows } from "../../src/core/utils/minecraft/eventTips.js";

describe("shared leaderboard helpers", () => {
  it("flags only deaths as including zero values", () => {
    const withZero = Object.entries(LEADERBOARD_STATS)
      .filter(([, def]) => def.includeZero)
      .map(([key]) => key);
    expect(withZero).toEqual(["deaths"]);
  });

  it("reads stat labels through the locale", () => {
    expect(LEADERBOARD_STATS["playtime"]!.label).toBe("Playtime");
    expect(STREAK_STAT_LABELS.streak).toBe("Current Daily Streak");
  });

  it("renders medals for the top three and numbers after that", () => {
    expect(formatRankLine(0, "A", "1")).toBe("🥇 **A**: 1");
    expect(formatRankLine(2, "C", "3")).toBe("🥉 **C**: 3");
    expect(formatRankLine(3, "D", "4")).toBe("**4.** **D**: 4");
  });

  it("uses one title-casing helper for stats and items", () => {
    expect(humanizeKey).toBe(humanizeId);
    expect(itemDisplayName("create:brass_ingot")).toBe("Brass Ingot");
    expect(humanizeKey("minecraft:walk_one_cm")).toBe("Walk One Cm");
  });
});

describe("ledgerAllows", () => {
  const record = (over: Partial<{ count: number; lastAt: number; dismissed: boolean }>) =>
    ({ count: 0, lastAt: 0, dismissed: false, ...over }) as never;

  it("allows a first mention", () => {
    expect(ledgerAllows(undefined, { maxMentions: 2 })).toBe(true);
    expect(ledgerAllows(null, { maxMentions: 2 })).toBe(true);
  });

  it("lets a dismissal win over everything", () => {
    expect(ledgerAllows(record({ dismissed: true }), { maxMentions: 9 })).toBe(false);
  });

  it("stops at the mention cap", () => {
    expect(ledgerAllows(record({ count: 2 }), { maxMentions: 2 })).toBe(false);
    expect(ledgerAllows(record({ count: 1 }), { maxMentions: 2 })).toBe(true);
  });

  it("applies the cooldown only when one is given", () => {
    const r = record({ count: 1, lastAt: 1000 });
    expect(ledgerAllows(r, { maxMentions: 3, cooldownMs: 500, now: 1200 })).toBe(false);
    expect(ledgerAllows(r, { maxMentions: 3, cooldownMs: 500, now: 1600 })).toBe(true);
    expect(ledgerAllows(r, { maxMentions: 3, now: 1200 })).toBe(true);
  });
});
