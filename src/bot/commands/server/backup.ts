import { SlashCommandBuilder } from "discord.js";
import { createEmbed, createInfoEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { relativeTimestamp } from "../../utils/discordTime.js";
import * as serverAccess from "@mcbot/core/utils/server/serverAccess.js";
import { requireCapability } from "@mcbot/core/utils/server/capabilities.js";
import { resolveLanguage, t } from "@mcbot/core/utils/i18n.js";
import { backupTierLabel } from "@mcbot/schema/glossary.js";
import { formatBytes } from "@mcbot/schema";

export const data = new SlashCommandBuilder()
  .setName("backup")
  .setDescription("Show backup status for a server")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  requireCapability(server, (c) => c.backups, t("capability.feature.backups"));

  const { dirs, totalBytes } = await serverAccess.readBackups(server.config);
  const title = t("backup.title", { server: server.id });

  if (dirs.length === 0) {
    await interaction.editReply({ embeds: [createInfoEmbed(t("backup.none"), { title })] });
    return;
  }

  // The one number that matters when things go wrong: how old the newest
  // backup is across all tiers.
  const newest = dirs.reduce((a, b) =>
    a.latestMtime.getTime() >= b.latestMtime.getTime() ? a : b,
  );
  const count = dirs.reduce((n, b) => n + b.count, 0);

  const language = resolveLanguage();
  const embed = createEmbed({
    title,
    description: t("backup.summary", {
      count,
      total: formatBytes(totalBytes),
      age: since(newest.latestMtime),
    }),
  });

  for (const b of dirs) {
    embed.addFields({
      name: backupTierLabel(b.dir, language),
      value: t("backup.entry", {
        count: b.count,
        age: since(b.latestMtime),
        size: formatBytes(b.latestSizeBytes),
      }),
      inline: true,
    });
  }

  await interaction.editReply({ embeds: [embed] });
});

function since(date: Date): string {
  return relativeTimestamp(date.getTime());
}

