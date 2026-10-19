import { describe, it, expect } from "vitest";
import {
  consoleCommandVerbs,
  isBlockedConsoleCommand,
} from "../../src/schema/consoleCommands.js";

describe("consoleCommandVerbs", () => {
  it("returns just the verb for a plain command", () => {
    expect(consoleCommandVerbs("/Say hello")).toEqual(["say"]);
  });

  it("follows `return run` like `execute run`", () => {
    expect(consoleCommandVerbs("return run op Steve")).toEqual(["return", "op"]);
  });

  it("inspects every run token, not only the first", () => {
    expect(consoleCommandVerbs("execute as run run op me")).toEqual([
      "execute",
      "run",
      "op",
    ]);
  });

  it("follows nested chains", () => {
    expect(consoleCommandVerbs("execute as @a run execute run minecraft:stop")).toEqual([
      "execute",
      "execute",
      "stop",
    ]);
  });

  it("stays fast on a long chain of run tokens", () => {
    const chain = Array.from({ length: 60 }, () => "execute run").join(" ");
    expect(consoleCommandVerbs(`${chain} op me`)).toContain("op");
  });
});

describe("isBlockedConsoleCommand with run chains", () => {
  it("blocks op behind `return run`", () => {
    expect(isBlockedConsoleCommand("return run op Steve", ["op"])).toBe(true);
  });

  it("blocks op behind a player or score named run", () => {
    expect(isBlockedConsoleCommand("execute as run run op me", ["op"])).toBe(true);
  });

  it("allows harmless commands", () => {
    expect(isBlockedConsoleCommand("return run say hi", ["op"])).toBe(false);
  });
});
