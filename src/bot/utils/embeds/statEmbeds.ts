import { type APIEmbedField, type EmbedBuilder } from "discord.js";
import {
  chunkLines,
  createEmbed,
  createEmbedWithThumbnail,
  paginateFields,
  reservedLength,
} from "./embedUtils.js";
import { playerAvatarUrl } from "../mcHeads.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import {
  humanizeKey,
  ticksToMs,
  formatDistance,
  type LeaderboardData,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import type { FlattenedStat } from "@mcbot/core/types/index.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";

import { t } from "@mcbot/core/utils/i18n.js";

/**
 * Converts plain leaderboard data (from buildLeaderboard) into a Discord EmbedBuilder.
 */
export function buildLeaderboardEmbed({
  title,
  description,
  footerText,
  entries,
}: LeaderboardData): EmbedBuilder {
  const leader = entries[0]?.name;
  return createEmbedWithThumbnail({
    title,
    description,
    category: EmbedCategory.Leaderboard,
    footer: { text: footerText },
    ...(leader ? { thumbnail: playerAvatarUrl(leader) } : {}),
  });
}

/**
 * Builds the pages for a player's stats: one or more fields per category
 * (each under Discord's 1024 character field limit), at most two fields per
 * page so a page stays readable on a phone.
 */
export function buildStatsEmbeds(
  stats: FlattenedStat[],
  username: string,
): EmbedBuilder[] {
  const fields: APIEmbedField[] = [];

  for (const [category, entries] of Object.entries(groupByCategory(stats))) {
    const lines = entries.map((s) => {
      const key = s.key.toLowerCase();
      const isTime = /(_time|Time)$/.test(s.key);
      const isDistance = /one_cm$/.test(key);
      const displayValue = isTime
        ? formatSpan(ticksToMs(s.value))
        : isDistance
          ? formatDistance(s.value)
          : s.value.toLocaleString();
      return `• ${humanizeKey(s.key)}: ${displayValue}`;
    });

    chunkLines(lines).forEach((value, i) => {
      const lineCount = value.split("\n").length;
      fields.push({
        name: i === 0 ? humanizeKey(category) : `${humanizeKey(category)} (${i + 1})`,
        value,
        inline: lineCount <= 3 && value.length <= 100,
      });
    });
  }

  if (fields.length === 0) return [];

  const title = t("stats.pageTitle", { name: username });
  const description = t("stats.total", { count: stats.length });
  return paginateFields(fields, {
    maxFields: 2,
    reserved: reservedLength({ title, description }),
  }).map((page) => createEmbed({ title, description }).addFields(page));
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
