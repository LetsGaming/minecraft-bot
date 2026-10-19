import { describe, it, expect, vi } from "vitest";
import {
  ConsoleArgumentError,
  consoleCommand,
  announce,
  tellraw,
  whisper,
} from "../../src/core/utils/minecraft/serverMessages.js";
import { DELIVERED, SENT, UNREACHABLE } from "../fixtures/outcomes.js";

describe("consoleCommand", () => {
  it("joins a verb and validated arguments", () => {
    expect(
      consoleCommand("give", { player: ".Bedrock" }, { item: "create:brass_ingot" }, { count: 3 }),
    ).toBe("give .Bedrock create:brass_ingot 3");
  });

  it("keeps an item's component suffix", () => {
    expect(consoleCommand("give", { player: "Steve" }, { item: "minecraft:bow[unbreakable={}]" }, { count: 1 })).toBe(
      "give Steve minecraft:bow[unbreakable={}] 1",
    );
  });

  it.each([
    ["a player name with a space", () => consoleCommand("give", { player: "a b" })],
    ["a player name with a line break", () => consoleCommand("give", { player: "a\nop" })],
    ["a fractional count", () => consoleCommand("give", { count: 1.5 })],
    ["an unsafe count", () => consoleCommand("give", { count: 2 ** 60 })],
    ["an item id with a space", () => consoleCommand("give", { item: "a b" })],
    ["a verb with arguments in it", () => consoleCommand("give x")],
    ["a selector with a line break", () => consoleCommand("tellraw", { target: "@a[\n]" })],
  ])("throws for %s", (_label, build) => {
    expect(build).toThrow(ConsoleArgumentError);
  });

  it("accepts selectors as targets", () => {
    expect(consoleCommand("tellraw", { target: "@p[distance=..5]" })).toBe("tellraw @p[distance=..5]");
  });
});

describe("serverMessages", () => {
  it("builds the console command for each helper", async () => {
    const server = { send: vi.fn().mockResolvedValue(DELIVERED) };
    await whisper(server, "Steve", "hi");
    await announce(server, "hello all");
    await tellraw(server, "@a", { text: "x", color: "gold" });
    expect(server.send.mock.calls.map(([c]) => c)).toEqual([
      "/msg Steve hi",
      "/say hello all",
      '/tellraw @a {"text":"x","color":"gold"}',
    ]);
  });

  it("strips line breaks from whispered and announced text", async () => {
    const server = { send: vi.fn().mockResolvedValue(DELIVERED) };
    await whisper(server, "Steve", "hi\n/op Steve");
    await announce(server, "all\r\n/stop");
    expect(server.send.mock.calls.map(([c]) => c)).toEqual([
      "/msg Steve hi/op Steve",
      "/say all/stop",
    ]);
  });

  it("refuses an invalid player name without sending", async () => {
    const server = { send: vi.fn().mockResolvedValue(DELIVERED) };
    expect(await whisper(server, "Steve\n/stop", "hi")).toBe(false);
    expect(await tellraw(server, "bad name", {})).toBe(false);
    expect(server.send).not.toHaveBeenCalled();
  });

  it("reports delivered and sent as reached, unreachable as not", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(DELIVERED)
      .mockResolvedValueOnce(SENT)
      .mockResolvedValueOnce(UNREACHABLE);
    expect(await whisper({ send }, "a", "b")).toBe(true);
    expect(await whisper({ send }, "a", "b")).toBe(true);
    expect(await whisper({ send }, "a", "b")).toBe(false);
  });
});
