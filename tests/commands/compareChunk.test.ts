/**
 * /compare's field chunker.
 *
 * Found in production: "basically never works on bigger data sets". The
 * chunker summed line lengths against Discord's 1024-char field limit, then
 * joined the lines with "\n" — so the value it actually sent was longer than
 * the one it measured, by one character per line. A chunk that counted 1020
 * shipped 1029 and discord.js rejected the field. It only bites once a
 * category fills a chunk, so it passed on thin fixtures and threw for every
 * real player.
 */
import { describe, it, expect } from "vitest";
import { buildComparisonEmbeds } from "../../src/bot/commands/stats/compare.js";
import type { FlattenedStat } from "../../src/core/types/index.js";

function stats(n: number, category = "cat"): FlattenedStat[] {
  return Array.from({ length: n }, (_, i) => ({
    category,
    key: `some_stat_key_number_${i}`,
    fullKey: `minecraft:custom.stat_${i}`,
    value: 123456 + i,
  })) as unknown as FlattenedStat[];
}

describe("buildComparisonEmbeds", () => {
  it.each([10, 60, 100, 500, 2000])(
    "builds valid embeds for %i shared stats",
    (n) => {
      const a = stats(n);
      expect(() => buildComparisonEmbeds(a, a, "PlayerOne", "PlayerTwo")).not.toThrow();
    },
  );

  it("never emits a field value over Discord's 1024 limit", () => {
    const a = stats(2000);
    const embeds = buildComparisonEmbeds(a, a, "PlayerOne", "PlayerTwo");
    const values = embeds.flatMap((e) => (e.data.fields ?? []).map((f) => f.value));
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v.length).toBeGreaterThan(0);
      expect(v.length).toBeLessThanOrEqual(1024);
    }
  });

  it("loses no shared stat to the chunking", () => {
    const a = stats(300);
    const embeds = buildComparisonEmbeds(a, a, "PlayerOne", "PlayerTwo");
    const rendered = embeds
      .flatMap((e) => (e.data.fields ?? []).map((f) => f.value))
      .join("\n");
    // Every stat must appear exactly once across all pages.
    for (const i of [0, 42, 299]) {
      expect(rendered).toContain(`Some Stat Key Number ${i}`);
    }
  });

  it("reports the shared-stat count in the footer", () => {
    const a = stats(50);
    const embeds = buildComparisonEmbeds(a, a, "PlayerOne", "PlayerTwo");
    expect(embeds[0]!.data.footer?.text).toContain("50");
  });
});
