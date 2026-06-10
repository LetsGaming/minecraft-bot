import { describe, it, expect } from "vitest";
import { stripLogPrefix } from "../src/utils/utils.js";

describe("stripLogPrefix", () => {
  it("returns empty string for empty input", () => {
    expect(stripLogPrefix("")).toBe("");
  });

  it("returns empty string for falsy input", () => {
    expect(stripLogPrefix("")).toBe("");
  });

  it("strips the standard ]: separator (with space)", () => {
    const line = "[12:00:00] [Server thread/INFO]: There are 2 players online";
    expect(stripLogPrefix(line)).toBe("There are 2 players online");
  });

  it("uses the last ]: occurrence when multiple exist", () => {
    const line = "[12:00:00] [INFO]: [Sub]: actual message";
    expect(stripLogPrefix(line)).toBe("actual message");
  });

  it("strips ]: without trailing space (fallback path)", () => {
    // No ]: with space, falls through to the ]: branch
    const line = "[12:00:00] [INFO]:message no space";
    expect(stripLogPrefix(line)).toBe("message no space");
  });

  it("falls back to ]: branch and trims leading colons/spaces", () => {
    const line = "[12:00:00] [INFO]:   padded";
    // ]: found, slice after ]: strips ":   " then trim
    expect(stripLogPrefix(line)).toBe("padded");
  });

  it("falls back to last ': ' when no ] is present", () => {
    const line = "SomePrefix: message content";
    expect(stripLogPrefix(line)).toBe("message content");
  });

  it("returns trimmed original when no known separator is found", () => {
    expect(stripLogPrefix("  plain message  ")).toBe("plain message");
  });

  it("handles a line that is only whitespace", () => {
    expect(stripLogPrefix("   ")).toBe("");
  });

  it("handles a real Paper join log line", () => {
    const line = "[12:34:56] [Server thread/INFO]: Steve joined the game";
    expect(stripLogPrefix(line)).toBe("Steve joined the game");
  });

  it("handles a real Fabric log line format", () => {
    const line =
      "[12:34:56] [Server thread/INFO] [minecraft/MinecraftServer]: Steve joined the game";
    expect(stripLogPrefix(line)).toBe("Steve joined the game");
  });
});
