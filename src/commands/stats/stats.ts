import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { loadStats, flattenStats, filterStats } from "../../utils/statUtils.js";
import { getSnapshotForDailyDiff } from "../../utils/snapshotUtils.js";
import { buildStatsEmbeds } from "../../utils/statEmbeds.js";
import { findPlayer } from "../../utils/playerUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { log } from "../../utils/logger.js";
import {
  createPaginationButtons,
  handlePagination,
  createErrorEmbed,
} from "../../utils/embedUtils.js";
import type { FlattenedStat } from "../../types/index.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const data = new SlashCommandBuilder()
  .setName("stats")
  .setDescription("Show Minecraft stats for a player")
  .addSubcommand((sub) =>
    sub
      .setName("player")
      .setDescription("Show all-time stats for a player")
      .addStringOption((option) =>
        option
          .setName("player")
          .setDescription("Minecraft player name")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName("stat")
          .setDescription("Optional stat category or specific stat ID"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("daily")
      .setDescription("Show stats gained in the last 24 hours")
      .addStringOption((option) =>
        option
          .setName("player")
          .setDescription("Minecraft player name")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((option) =>
        option
          .setName("stat")
          .setDescription("Optional stat category or specific stat ID"),
      ),
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const sub = interaction.options.getSubcommand();
  if (sub === "daily") {
    await runDaily(interaction);
  } else {
    await runPlayer(interaction);
  }
}

/**
 * Original /stats behaviour — full all-time stats.
 */
async function runPlayer(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const server = resolveServer(interaction) ?? undefined;
  const playerName = interaction.options.getString("player", true);
  const filterStat = interaction.options.getString("stat");

  try {
    const player = await findPlayer(playerName, server);
    if (!player) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Player \`${playerName}\` not found.`, {
            footer: { text: "Player Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const statsFile = await loadStats(player.uuid, server);
    if (!statsFile) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Stats file not found for \`${playerName}\`.`, {
            footer: { text: "Stats File Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    let flattened = flattenStats(statsFile);
    flattened = filterStats(flattened, filterStat);

    if (flattened.length === 0) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`No stats found matching \`${filterStat}\`.`, {
            footer: { text: "Stats Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const embeds = buildStatsEmbeds(flattened, playerName);

    if (embeds.length === 1) {
      await interaction.editReply({ embeds });
    } else {
      const message = await interaction.editReply({
        embeds: [embeds[0]!],
        components: [createPaginationButtons(0, embeds.length)],
      });

      await handlePagination(message, interaction, embeds);
    }
  } catch (err) {
    log.error("stats", err instanceof Error ? err.message : String(err));
    await interaction.editReply({
      embeds: [createErrorEmbed("Failed to retrieve stats.")],
    });
  }
}

/**
 * /stats daily — diff current stats against snapshot from ~24h ago.
 * Stats present now but missing in the baseline (or with value 0) count
 * as fully gained. Only positive deltas are shown — a server-side reset
 * could produce negative values which are meaningless in this context.
 */
async function runDaily(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  await interaction.deferReply();

  const server = resolveServer(interaction) ?? undefined;
  const playerName = interaction.options.getString("player", true);
  const filterStat = interaction.options.getString("stat");

  try {
    const player = await findPlayer(playerName, server);
    if (!player) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Player \`${playerName}\` not found.`, {
            footer: { text: "Player Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const statsFile = await loadStats(player.uuid, server);
    if (!statsFile) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(`Stats file not found for \`${playerName}\`.`, {
            footer: { text: "Stats File Not Found" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    const snapshot = await getSnapshotForDailyDiff(Date.now() - DAY_MS);
    if (!snapshot || !snapshot.flatStats) {
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            "No baseline snapshot available yet — try again later once stats have been recorded for at least 24h.",
            {
              footer: { text: "No Snapshot" },
              timestamp: new Date(),
            },
          ),
        ],
      });
      return;
    }

    const baseline = snapshot.flatStats[player.uuid] ?? {};
    const current = flattenStats(statsFile);

    // Diff current state against baseline. Stats not in baseline default to 0
    // (which usually means "didn't exist yet for this player") so the full
    // current value counts as gained. Drop zero/negative deltas.
    const delta: FlattenedStat[] = [];
    for (const stat of current) {
      const before = baseline[stat.fullKey] ?? 0;
      const diff = stat.value - before;
      if (diff <= 0) continue;
      delta.push({ ...stat, value: diff });
    }

    let filtered = filterStats(delta, filterStat);

    if (filtered.length === 0) {
      const reason = filterStat
        ? `No stats matching \`${filterStat}\` changed in the last 24h.`
        : `No stat changes in the last 24h for \`${playerName}\`.`;
      await interaction.editReply({
        embeds: [
          createErrorEmbed(reason, {
            footer: { text: "No Activity" },
            timestamp: new Date(),
          }),
        ],
      });
      return;
    }

    // Show how old the baseline actually is — if the bot just started,
    // it might be much less than 24h, and the user should know.
    const ageHours = (Date.now() - snapshot.timestamp) / (60 * 60 * 1000);
    const periodLabel = `last ${ageHours.toFixed(1)}h`;
    const embeds = buildStatsEmbeds(filtered, `${playerName} — ${periodLabel}`);

    if (embeds.length === 1) {
      await interaction.editReply({ embeds });
    } else {
      const message = await interaction.editReply({
        embeds: [embeds[0]!],
        components: [createPaginationButtons(0, embeds.length)],
      });

      await handlePagination(message, interaction, embeds);
    }
  } catch (err) {
    log.error("stats", err instanceof Error ? err.message : String(err));
    await interaction.editReply({
      embeds: [createErrorEmbed("Failed to retrieve daily stats.")],
    });
  }
}
