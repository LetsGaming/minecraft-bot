import { describe, it, expect } from "vitest";
import {
  buildChunkbaseUrl,
  chunkbaseDimension,
} from "../../src/core/utils/minecraft/chunkbaseUrl.js";

describe("chunkbaseDimension", () => {
  it.each([
    ["minecraft:overworld", "overworld"],
    ["overworld", "overworld"],
    ["minecraft:the_nether", "nether"],
    ["nether", "nether"],
    ["minecraft:the_end", "end"],
    ["THE_END", "end"],
    ["minecraft:something_modded", "overworld"],
    ["", "overworld"],
  ])("maps %s to %s", (input, expected) => {
    expect(chunkbaseDimension(input)).toBe(expected);
  });
});

describe("buildChunkbaseUrl", () => {
  it("builds a seed-map URL with seed and dimension", () => {
    expect(buildChunkbaseUrl("123", "minecraft:the_nether")).toBe(
      "https://www.chunkbase.com/apps/seed-map#seed=123&dimension=nether",
    );
  });

  it("defaults to the overworld", () => {
    expect(buildChunkbaseUrl("-5")).toBe(
      "https://www.chunkbase.com/apps/seed-map#seed=-5&dimension=overworld",
    );
  });

  it("appends floored coordinates, including negatives", () => {
    expect(buildChunkbaseUrl("1", "overworld", 10.9, -0.5)).toBe(
      "https://www.chunkbase.com/apps/seed-map#seed=1&dimension=overworld&x=10&z=-1",
    );
  });

  it("omits coordinates unless both x and z are given", () => {
    expect(buildChunkbaseUrl("1", "end", 5)).not.toContain("&x=");
    expect(buildChunkbaseUrl("1", "end", undefined, 5)).not.toContain("&z=");
  });

  it("keeps a zero coordinate", () => {
    expect(buildChunkbaseUrl("1", "end", 0, 0)).toContain("&x=0&z=0");
  });
});
