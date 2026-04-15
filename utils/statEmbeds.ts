import { type EmbedBuilder } from 'discord.js';
import { createEmbed } from './embedUtils.js';
import {
  humanizeKey,
  formatPlaytime,
  formatDistance,
} from './statUtils.js';
import type { FlattenedStat } from '../types/index.js';

/**
 * Builds an array of paginated embeds for displaying player stats.
 * Splits stats by category and chunks fields to stay within Discord's limits.
 */
export function buildStatsEmbeds(stats: FlattenedStat[], username: string): EmbedBuilder[] {
  const embeds: EmbedBuilder[] = [];
  let currentEmbed = createEmbed({ title: 'PLACEHOLDER' });
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
      const value = chunk.join('\n');

      if (fieldCount >= 2) {
        embeds.push(currentEmbed);
        currentEmbed = createEmbed({ title: 'PLACEHOLDER' });
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
    embed.data.title = `Stats for ${username} (Page ${i + 1}/${totalPages})`;
    embed.setFooter({
      text: `Total stats: ${stats.length} | Page ${i + 1}/${totalPages}`,
    });
  }

  return embeds;
}

function groupByCategory(stats: FlattenedStat[]): Record<string, FlattenedStat[]> {
  const grouped: Record<string, FlattenedStat[]> = {};
  for (const stat of stats) {
    if (!grouped[stat.category]) {
      grouped[stat.category] = [];
    }
    grouped[stat.category]!.push(stat);
  }
  return grouped;
}
