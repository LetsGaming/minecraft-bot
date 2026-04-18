import { describe, it, expect } from "vitest";
import { parseListOutput } from "../src/utils/playerUtils.js";

describe("parseListOutput", () => {
  it('parses vanilla "of a max of" format with players', () => {
    const log =
      "[12:00:00] [Server thread/INFO]: There are 2 of a max of 20 players online: Alice, Bob";
    const result = parseListOutput(log);
    expect(result.playerCount).toBe("2");
    expect(result.maxPlayers).toBe("20");
    expect(result.players).toContain("Alice");
    expect(result.players).toContain("Bob");
  });

  it('parses Paper "/" format', () => {
    const log =
      "[12:00:00] [Server thread/INFO]: There are 1/20 players online: Steve";
    const result = parseListOutput(log);
    expect(result.playerCount).toBe("1");
    expect(result.maxPlayers).toBe("20");
    expect(result.players).toContain("Steve");
  });

  it("returns unknown for null input", () => {
    const result = parseListOutput(null);
    expect(result.playerCount).toBe("unknown");
    expect(result.maxPlayers).toBe("unknown");
    expect(result.players).toEqual([]);
  });

  it("returns empty player list when no players online", () => {
    const log =
      "[12:00:00] [Server thread/INFO]: There are 0 of a max of 20 players online:";
    const result = parseListOutput(log);
    expect(result.playerCount).toBe("0");
    expect(result.players).toEqual([]);
  });

  it("returns unknown for log with no player line", () => {
    const log = "[12:00:00] [Server thread/INFO]: Some other log line";
    const result = parseListOutput(log);
    expect(result.playerCount).toBe("unknown");
  });

  it("uses the last matching line when multiple player lines exist", () => {
    const log = [
      "[11:00:00] [Server thread/INFO]: There are 1 of a max of 20 players online: OldPlayer",
      "[12:00:00] [Server thread/INFO]: There are 3 of a max of 20 players online: A, B, C",
    ].join("\n");
    const result = parseListOutput(log);
    expect(result.playerCount).toBe("3");
    expect(result.players).toEqual(["A", "B", "C"]);
  });
});
