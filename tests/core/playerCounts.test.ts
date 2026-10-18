import { describe, it, expect } from "vitest";
import { parsePlayerCounts } from "../../src/core/utils/minecraft/playerCounts.js";

describe("parsePlayerCounts", () => {
  it("reads both counts", () => {
    expect(parsePlayerCounts({ playerCount: "3", maxPlayers: "20" })).toEqual({ online: 3, max: 20 });
  });

  it("treats the ? sentinel and unreadable values as unknown, not zero", () => {
    expect(parsePlayerCounts({ playerCount: "0", maxPlayers: "?" })).toEqual({ online: 0, max: null });
    expect(parsePlayerCounts({ playerCount: "unknown", maxPlayers: "unknown" })).toEqual({
      online: null,
      max: null,
    });
    expect(parsePlayerCounts({ playerCount: undefined, maxPlayers: NaN })).toEqual({ online: null, max: null });
  });

  it("accepts numbers", () => {
    expect(parsePlayerCounts({ playerCount: 2, maxPlayers: 10 })).toEqual({ online: 2, max: 10 });
  });
});
