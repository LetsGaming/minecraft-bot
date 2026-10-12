import { describe, it, expect } from "vitest";
import { EmbedBuilder } from "discord.js";
import {
  buildLeaderboardEmbed,
  buildStatsEmbeds,
} from "../../src/bot/utils/embeds/statEmbeds.js";
import type { LeaderboardData } from "../../src/core/utils/minecraft/statUtils.js";
import type { FlattenedStat } from "../../src/core/types/index.js";

// ── buildLeaderboardEmbed ────────────────────────────────────────────────────

describe("buildLeaderboardEmbed", () => {
  const sampleData: LeaderboardData = {
    entries: [],
    title: "🏆 Leaderboard — Playtime",
    description: "🥇 **Steve** — 2 d 3 h\n🥈 **Alex** — 1 d",
    footerText: "2 players tracked",
  };

  it("returns an EmbedBuilder instance", () => {
    expect(buildLeaderboardEmbed(sampleData)).toBeInstanceOf(EmbedBuilder);
  });

  it("sets the title from LeaderboardData", () => {
    const embed = buildLeaderboardEmbed(sampleData);
    expect(embed.toJSON().title).toBe("🏆 Leaderboard — Playtime");
  });

  it("sets the description from LeaderboardData", () => {
    const embed = buildLeaderboardEmbed(sampleData);
    expect(embed.toJSON().description).toContain("Steve");
  });

  it("sets the footer to footerText", () => {
    const embed = buildLeaderboardEmbed(sampleData);
    expect(embed.toJSON().footer?.text).toBe("2 players tracked");
  });

  it("works with empty description", () => {
    const data: LeaderboardData = {
      ...sampleData,
      description: "No data available.",
    };
    const embed = buildLeaderboardEmbed(data);
    expect(embed.toJSON().description).toBe("No data available.");
  });
});

// ── buildStatsEmbeds ─────────────────────────────────────────────────────────

const minimalStats: FlattenedStat[] = [
  {
    fullKey: "minecraft:custom.minecraft:deaths",
    category: "minecraft:custom",
    key: "minecraft:deaths",
    value: 5,
  },
  {
    fullKey: "minecraft:custom.minecraft:play_time",
    category: "minecraft:custom",
    key: "minecraft:play_time",
    value: 72000,
  },
  {
    fullKey: "minecraft:mined.minecraft:stone",
    category: "minecraft:mined",
    key: "minecraft:stone",
    value: 100,
  },
];

const distanceStats: FlattenedStat[] = [
  {
    fullKey: "minecraft:custom.minecraft:walk_one_cm",
    category: "minecraft:custom",
    key: "minecraft:walk_one_cm",
    value: 100000,
  },
  {
    fullKey: "minecraft:custom.minecraft:fly_one_cm",
    category: "minecraft:custom",
    key: "minecraft:fly_one_cm",
    value: 50000,
  },
];

describe("buildStatsEmbeds", () => {
  it("returns an array of at least one EmbedBuilder for non-empty stats", () => {
    const embeds = buildStatsEmbeds(minimalStats, "Steve");
    expect(embeds.length).toBeGreaterThan(0);
    expect(embeds[0]).toBeInstanceOf(EmbedBuilder);
  });

  it("returns an empty array when stats is empty", () => {
    expect(buildStatsEmbeds([], "Steve")).toHaveLength(0);
  });

  it("sets embed title to include the username", () => {
    const embeds = buildStatsEmbeds(minimalStats, "Notch");
    expect(embeds[0]!.toJSON().title).toContain("Notch");
  });

  it("leaves the page number to the pager, not the title", () => {
    const embeds = buildStatsEmbeds(minimalStats, "Steve");
    expect(embeds[0]!.toJSON().title).not.toMatch(/Page \d+\/\d+/);
  });

  it("states the total stats count in the description, with no footer", () => {
    const json = buildStatsEmbeds(minimalStats, "Steve")[0]!.toJSON();
    expect(json.description).toContain(String(minimalStats.length));
    expect(json.footer).toBeUndefined();
  });

  it("formats _time keys as human-readable duration", () => {
    const embeds = buildStatsEmbeds(minimalStats, "Steve");
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    const timeField = allFields.find((f) => f.value.includes("Play Time: 1 h"));
    expect(timeField).toBeDefined();
  });

  it("formats _one_cm keys as distance strings", () => {
    const embeds = buildStatsEmbeds(distanceStats, "Alex");
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    const distField = allFields.find((f) => f.value.match(/\d+km/));
    expect(distField).toBeDefined();
  });

  it("groups stats by category into fields", () => {
    const embeds = buildStatsEmbeds(minimalStats, "Steve");
    const allFields = embeds.flatMap((e) => e.toJSON().fields ?? []);
    // Should have one field for custom and one for mined (2 categories)
    expect(allFields.length).toBeGreaterThanOrEqual(2);
  });

  it("creates multiple pages when there are many stat categories", () => {
    // Create 10 distinct categories to force pagination (3 fields per embed)
    const manyStats: FlattenedStat[] = Array.from({ length: 10 }, (_, i) => ({
      fullKey: `cat_${i}.key_${i}`,
      category: `cat_${i}`,
      key: `key_${i}`,
      value: i + 1,
    }));
    const embeds = buildStatsEmbeds(manyStats, "Player");
    expect(embeds.length).toBeGreaterThan(1);
  });
});
