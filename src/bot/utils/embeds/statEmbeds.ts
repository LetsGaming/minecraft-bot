import { type EmbedBuilder } from "discord.js";
import { createEmbed } from "./embedUtils.js";
import {
  humanizeKey,
  formatPlaytime,
  formatDistance,
  type LeaderboardData,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import type { FlattenedStat } from "@mcbot/core/types/index.js";

import { t } from "@mcbot/core/utils/i18n.js";
/**
 * Converts plain leaderboard data (from buildLeaderboard) into a Discord EmbedBuilder.
 */
export function buildLeaderboardEmbed({
  title,
  description,
  footerText,
}: LeaderboardData): EmbedBuilder {
  return createEmbed({
    title,
    description,
    footer: { text: footerText },
  });
}

/**
 * Builds an array of paginated embeds for displaying player stats.
 * Splits stats by category and chunks fields to stay within Discord's limits.
 */
export function buildStatsEmbeds(
  stats: FlattenedStat[],
  username: string,
): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  let currentEmbed = createEmbed({});
  let fieldCount = 0;

  const grouped = groupByCategory(stats);

  for (const [category, entries] of Object.entries(grouped)) {
    const lines = entries.map((s) => {
      const key = s.key.toLowerCase();
      const value = s.value;

      const isTime = /(_time|Time)$/.test(key);
      const isDistance = /one_cm$/.test(key);

      let displayValue: string;
      if (isTime) {
        displayValue = formatPlaytime(value);
      } else if (isDistance) {
        displayValue = formatDistance(value);
      } else {
        displayValue = value.toLocaleString();
      }

      return `• ${humanizeKey(s.key)}: ${displayValue}`;
    });

    let index = 0;
    let chunkNumber = 1;

    while (index < lines.length) {
      const chunk: string[] = [];
      let chunkLength = 0;

      while (
        index < lines.length &&
        chunkLength + lines[index]!.length + 1 < 1024
      ) {
        chunk.push(lines[index]!);
        chunkLength += lines[index]!.length + 1;
        index++;
      }

      const name =
        chunkNumber === 1
          ? humanizeKey(category)
          : `${humanizeKey(category)} (${chunkNumber})`;
      const value = chunk.join("\n");

      if (fieldCount >= 2) {
        embeds.push(currentEmbed);
        currentEmbed = createEmbed({});
        fieldCount = 0;
      }

      currentEmbed.addFields({
        name,
        value,
        inline: chunk.length <= 3 && chunkLength <= 100,
      });

      fieldCount++;
      chunkNumber++;
    }
  }

  if (fieldCount > 0) {
    embeds.push(currentEmbed);
  }

  const totalPages = embeds.length;
  for (let i = 0; i < totalPages; i++) {
    const embed = embeds[i]!;
    embed.setTitle(
      t("stats.pageTitle", { name: username, page: i + 1, pages: totalPages }),
    );
    embed.setFooter({
      text: t("stats.pageFooter", {
        total: stats.length,
        page: i + 1,
        pages: totalPages,
      }),
    });
  }

  return embeds;
}

function groupByCategory(
  stats: FlattenedStat[],
): Record<string, FlattenedStat[]> {
  const grouped: Record<string, FlattenedStat[]> = {};
  for (const stat of stats) {
    if (!grouped[stat.category]) {
      grouped[stat.category] = [];
    }
    grouped[stat.category]!.push(stat);
  }
  return grouped;
}
