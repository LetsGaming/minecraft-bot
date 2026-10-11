import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import { loadStats, flattenStats, filterStats } from "@mcbot/core/utils/minecraft/statUtils.js";
import { getSnapshotForDailyDiff } from "@mcbot/core/utils/minecraft/snapshotUtils.js";
import { buildStatsEmbeds } from "../../utils/embeds/statEmbeds.js";
import { findPlayer } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import { withErrorHandling } from "../middleware.js";
import { noStatsYet, playerNotFound } from "./statErrors.js";
import type { FlattenedStat } from "@mcbot/core/types/index.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
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
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
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
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

export const execute = withErrorHandling(async (interaction) => {
  const sub = interaction.options.getSubcommand();
  if (sub === "daily") {
    await runDaily(interaction);
  } else {
    await runPlayer(interaction);
  }
});

async function replyPaged(
  interaction: ChatInputCommandInteraction,
  embeds: EmbedBuilder[],
): Promise<void> {
  if (embeds.length === 1) {
    await interaction.editReply({ embeds });
    return;
  }
  const message = await interaction.editReply({
    embeds: [embeds[0]!],
    components: [createPaginationButtons(0, embeds.length)],
  });
  await handlePagination(message, interaction, embeds);
}

/**
 * All-time stats, optionally filtered by category or stat id.
 */
async function runPlayer(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const server = resolveServer(interaction);
  const playerName = interaction.options.getString("player", true);
  const filterStat = interaction.options.getString("stat");

  const player = await findPlayer(playerName, server);
  if (!player) throw playerNotFound(playerName);

  const statsFile = await loadStats(player.uuid, server).catch((err: unknown) => {
    log.error("stats", errMsg(err));
    throw new CommandError({ problem: t("stats.failed"), recovery: t("common.retryLater") });
  });
  if (!statsFile) throw noStatsYet(playerName);

  const flattened = filterStats(flattenStats(statsFile), filterStat);
  if (flattened.length === 0) {
    throw new CommandError({
      title: t("stats.noMatchTitle"),
      problem: t("stats.noMatch", { filter: filterStat }),
      recovery: t("stats.noMatchRecovery"),
    });
  }

  await replyPaged(interaction, buildStatsEmbeds(flattened, playerName));
}

/**
 * /stats daily: diff current stats against the snapshot from about 24 h ago.
 * Stats present now but missing in the baseline (or with value 0) count
 * as fully gained. Only positive deltas are shown; a server-side reset
 * could produce negative values which are meaningless in this context.
 */
async function runDaily(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const server = resolveServer(interaction);
  const playerName = interaction.options.getString("player", true);
  const filterStat = interaction.options.getString("stat");

  const player = await findPlayer(playerName, server);
  if (!player) throw playerNotFound(playerName);

  const statsFile = await loadStats(player.uuid, server);
  if (!statsFile) throw noStatsYet(playerName);

  const snapshot = await getSnapshotForDailyDiff(server.id, Date.now() - DAY_MS);
  if (!snapshot || !snapshot.flatStats) {
    throw new CommandError({
      title: t("stats.noSnapshotTitle"),
      problem: t("stats.noSnapshot"),
      recovery: t("stats.noSnapshotRecovery"),
    });
  }

  const baseline = snapshot.flatStats[player.uuid] ?? {};
  const delta: FlattenedStat[] = [];
  for (const stat of flattenStats(statsFile)) {
    const diff = stat.value - (baseline[stat.fullKey] ?? 0);
    if (diff > 0) delta.push({ ...stat, value: diff });
  }

  const filtered = filterStats(delta, filterStat);
  if (filtered.length === 0) {
    throw new CommandError({
      title: t("stats.noActivityTitle"),
      problem: filterStat
        ? t("stats.noChangeFiltered", { filter: filterStat })
        : t("stats.noChange", { player: playerName }),
    });
  }

  // The baseline can be younger than 24 h right after a bot start; the label
  // says how old it really is.
  const ageHours = (Date.now() - snapshot.timestamp) / (60 * 60 * 1000);
  await replyPaged(
    interaction,
    buildStatsEmbeds(
      filtered,
      t("stats.dailyLabel", { player: playerName, hours: ageHours.toFixed(1) }),
    ),
  );
}
