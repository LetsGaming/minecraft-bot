import { SlashCommandBuilder, type APIEmbedField } from "discord.js";
import {
  flattenStats,
  filterStats,
  humanizeKey,
  ticksToMs,
  formatDistance,
} from "@mcbot/core/utils/minecraft/statUtils.js";
import {
  chunkLines,
  createEmbed,
  createInfoEmbed,
  paginateFields,
  reservedLength,
} from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { replyPaged } from "../shared/paged.js";
import { loadStatsOrFail, noStatsYet, playerNotFound } from "./statErrors.js";
import { findPlayer } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import type { EmbedBuilder } from "discord.js";
import type { FlattenedStat } from "@mcbot/core/types/index.js";

import { formatSpan } from "@mcbot/core/utils/duration.js";
import { t } from "@mcbot/core/utils/i18n.js";
export const data = new SlashCommandBuilder()
  .setName("compare")
  .setDescription("Compare stats of two players")
  .addStringOption((option) =>
    option
      .setName("player1")
      .setDescription("First player name")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName("player2")
      .setDescription("Second player name")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((option) =>
    option
      .setName("stat")
      .setDescription("Optional stat category or specific stat ID")
      .setRequired(false),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const player1 = interaction.options.getString("player1", true);
  const player2 = interaction.options.getString("player2", true);
  const filterStat = interaction.options.getString("stat");

  const [player1Data, player2Data] = await Promise.all([
    findPlayer(player1, server),
    findPlayer(player2, server),
  ]);
  if (!player1Data) throw playerNotFound(player1);
  if (!player2Data) throw playerNotFound(player2);

  const [stats1, stats2] = await Promise.all([
    loadStatsOrFail(player1Data.uuid, server),
    loadStatsOrFail(player2Data.uuid, server),
  ]);
  if (!stats1) throw noStatsYet(player1);
  if (!stats2) throw noStatsYet(player2);

  const embeds = buildComparisonEmbeds(
    filterStats(flattenStats(stats1), filterStat),
    filterStats(flattenStats(stats2), filterStat),
    player1,
    player2,
  );

  if (embeds.length === 0) {
    await interaction.editReply({
      embeds: [createInfoEmbed(t("compare.noStats", { player1, player2 }))],
    });
    return;
  }

  await replyPaged(interaction, embeds);
});

interface ComparisonLine {
  category: string;
  line: string;
}

export function buildComparisonEmbeds(
  flat1: FlattenedStat[],
  flat2: FlattenedStat[],
  name1: string,
  name2: string,
): EmbedBuilder[] {
  const statMap2 = new Map(flat2.map((stat) => [stat.fullKey, stat]));
  const combined: ComparisonLine[] = [];

  for (const s1 of flat1) {
    const s2 = statMap2.get(s1.fullKey);
    if (!s2) continue;

    const key = s1.key.toLowerCase();
    const format = key.includes("time")
      ? (v: number) => formatSpan(ticksToMs(v))
      : key.includes("one_cm")
        ? formatDistance
        : (v: number) => v.toLocaleString();

    const line = `• ${humanizeKey(s1.key)}:\n> ${name1}: ${format(s1.value)}\n> ${name2}: ${format(s2.value)}`;
    combined.push({ category: s1.category, line });
  }

  const grouped: Record<string, string[]> = {};
  for (const item of combined) {
    (grouped[item.category] ??= []).push(item.line);
  }

  const fields: APIEmbedField[] = [];
  for (const [category, lines] of Object.entries(grouped)) {
    chunkLines(lines).forEach((value, i) => {
      fields.push({
        name: i === 0 ? humanizeKey(category) : `${humanizeKey(category)} (${i + 1})`,
        value,
        inline: false,
      });
    });
  }
  if (fields.length === 0) return [];

  const title = t("compare.title", { player1: name1, player2: name2 });
  const description = t("compare.shared", { count: combined.length });
  return paginateFields(fields, {
    maxFields: 2,
    reserved: reservedLength({ title, description }),
  }).map((page) => createEmbed({ title, description }).addFields(page));
}
