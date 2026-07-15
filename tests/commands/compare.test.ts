/**
 * Tests for the exported buildComparisonEmbeds function in compare.ts.
 * This is a pure embed-building function — no Discord client or server needed.
 */
import { describe, it, expect } from "vitest";
import { EmbedBuilder } from "discord.js";
import { buildComparisonEmbeds } from "../../src/bot/commands/stats/compare.js";
import type { FlattenedStat } from "../../src/core/types/index.js";

const player1Stats: FlattenedStat[] = [
  {
    fullKey: "minecraft:custom.minecraft:play_time",
    category: "minecraft:custom",
    key: "minecraft:play_time",
    value: 144000,
  },
  {
    fullKey: "minecraft:custom.minecraft:deaths",
    category: "minecraft:custom",
    key: "minecraft:deaths",
    value: 10,
  },
  {
    fullKey: "minecraft:mined.minecraft:stone",
    category: "minecraft:mined",
    key: "minecraft:stone",
    value: 500,
  },
  {
    fullKey: "minecraft:custom.minecraft:walk_one_cm",
    category: "minecraft:custom",
    key: "minecraft:walk_one_cm",
    value: 100_000,
  },
];

const player2Stats: FlattenedStat[] = [
  {
    fullKey: "minecraft:custom.minecraft:play_time",
    category: "minecraft:custom",
    key: "minecraft:play_time",
    value: 72000,
  },
  {
    fullKey: "minecraft:custom.minecraft:deaths",
    category: "minecraft:custom",
    key: "minecraft:deaths",
    value: 5,
  },
  {
    fullKey: "minecraft:mined.minecraft:stone",
    category: "minecraft:mined",
    key: "minecraft:stone",
    value: 300,
  },
  {
    fullKey: "minecraft:custom.minecraft:walk_one_cm",
    category: "minecraft:custom",
    key: "minecraft:walk_one_cm",
    value: 50_000,
  },
];

describe("buildComparisonEmbeds", () => {
  it("returns an array of EmbedBuilder instances", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds[0]).toBeInstanceOf(EmbedBuilder);
  });

  it("includes both player names in the embed title", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    expect(embeds[0]!.toJSON().title).toContain("Steve");
    expect(embeds[0]!.toJSON().title).toContain("Alex");
  });

  it("includes page numbering in titles", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    expect(embeds[0]!.toJSON().title).toMatch(/Page \d+\/\d+/);
  });

  it("sets footer with shared stat count", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    expect(embeds[0]!.toJSON().footer?.text).toContain("Shared stats");
  });

  it("returns an empty array when stats share no fullKeys", () => {
    const unique1: FlattenedStat[] = [
      { fullKey: "cat1.key1", category: "cat1", key: "key1", value: 1 },
    ];
    const unique2: FlattenedStat[] = [
      { fullKey: "cat2.key2", category: "cat2", key: "key2", value: 2 },
    ];
    const embeds = buildComparisonEmbeds(unique1, unique2, "A", "B");
    expect(embeds).toHaveLength(0);
  });

  it("formats play_time values as human-readable duration (not raw numbers)", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    const hasTimeFormat = allFields.some((f) => f.value.match(/\d+d \d+h/));
    expect(hasTimeFormat).toBe(true);
  });

  it("formats walk_one_cm values as distance strings", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    const hasDistFormat = allFields.some((f) => f.value.match(/\d+km/));
    expect(hasDistFormat).toBe(true);
  });

  it("groups stats by category into embed fields", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    // Should have at least 2 fields (minecraft:custom and minecraft:mined categories)
    expect(allFields.length).toBeGreaterThanOrEqual(2);
  });

  it("creates multiple pages when there are many stat categories", () => {
    const manyStats: FlattenedStat[] = Array.from({ length: 20 }, (_, i) => ({
      fullKey: `cat_${i}.key_${i}`,
      category: `cat_${i}`,
      key: `key_${i}`,
      value: i + 1,
    }));
    const embeds = buildComparisonEmbeds(manyStats, manyStats, "P1", "P2");
    expect(embeds.length).toBeGreaterThan(1);
  });

  it("includes both player values in each field", () => {
    const embeds = buildComparisonEmbeds(
      player1Stats,
      player2Stats,
      "Steve",
      "Alex",
    );
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    const someField = allFields.find(
      (f) => f.value.includes("Steve") && f.value.includes("Alex"),
    );
    expect(someField).toBeDefined();
  });

  it("handles empty stats arrays gracefully", () => {
    const embeds = buildComparisonEmbeds([], [], "A", "B");
    expect(embeds).toHaveLength(0);
  });
});
