import { describe, it, expect } from "vitest";
import { entityDataPattern, newestServerMatch, serverLineBodies } from "../../src/core/utils/minecraft/consoleResponse.js";

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

describe("entityDataPattern", () => {
  it("matches a Floodgate name with a leading dot", () => {
    const m = entityDataPattern(".Steve").exec(
      ".Steve has the following entity data: [1.0d, 64.0d, 2.0d]",
    );
    expect(m?.[1]).toBe("[1.0d, 64.0d, 2.0d]");
  });

  it("does not let the dot match any character", () => {
    expect(
      entityDataPattern(".Steve").test("xSteve has the following entity data: 1"),
    ).toBe(false);
  });

  it("matches nothing for an invalid name instead of rewriting it", () => {
    const pattern = entityDataPattern("Ste ve|");
    expect(pattern.test("Steve has the following entity data: 1")).toBe(false);
    expect(pattern.test("Ste ve| has the following entity data: 1")).toBe(false);
  });
});
