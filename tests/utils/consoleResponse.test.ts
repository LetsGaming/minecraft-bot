import { describe, it, expect } from "vitest";
import { newestServerMatch, serverLineBodies } from "../../src/core/utils/minecraft/consoleResponse.js";

describe("consoleResponse", () => {
  it("reads console replies with and without the 26.3 System chat marker, newest first", () => {
    const tail = [
      "[12:00:00] [Server thread/INFO]: Seed: [111]",
      "[12:00:01] [Server thread/INFO]: System chat: Seed: [222]",
    ].join("\n");
    expect(serverLineBodies(tail)).toEqual(["Seed: [222]", "Seed: [111]"]);
    expect(newestServerMatch(tail, /^Seed: \[(-?\d+)\]$/)?.[1]).toBe("222");
  });

  it("never takes a reply from player chat or /say", () => {
    const tail = [
      "[12:00:00] [Server thread/INFO]: <Mallory> Seed: [666]",
      "[12:00:01] [Server thread/INFO]: <Mallory> System chat: Seed: [666]",
      "[12:00:02] [Server thread/INFO]: System chat: [Mallory] Seed: [666]",
      "[12:00:03] [Async Chat Thread - #0/INFO]: System chat: Seed: [666]",
    ].join("\n");
    expect(newestServerMatch(tail, /^Seed: \[(-?\d+)\]$/)).toBeNull();
  });
});
