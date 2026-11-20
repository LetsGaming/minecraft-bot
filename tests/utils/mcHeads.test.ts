import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { playerAvatarUrl } from "../../src/bot/utils/mcHeads.js";
import { playerHeadUrl } from "../../src/core/utils/minecraft/playerHead.js";

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0);
const DAY = Math.floor(NOW / 86_400_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("playerAvatarUrl", () => {
  it("draws a head from the player's name, versioned by day", () => {
    expect(playerAvatarUrl("BangBoomBang19")).toBe(`https://mc-heads.net/avatar/BangBoomBang19/64?v=${DAY}`);
  });

  it("encodes the name", () => {
    expect(playerAvatarUrl("Some Name")).toBe(`https://mc-heads.net/avatar/Some%20Name/64?v=${DAY}`);
  });

  it("is the same builder the dashboard uses", () => {
    expect(playerAvatarUrl("Steve")).toBe(playerHeadUrl("Steve"));
  });
});
