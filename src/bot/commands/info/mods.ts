/**
 * /mods: lists the installed server mods, grouped by what a client needs.
 *
 * Mod metadata is fetched from Modrinth in a single batched request and cached
 * in memory; the cache is invalidated automatically when downloaded_versions.json
 * changes on disk. A modpack easily exceeds one embed, so the groups are
 * spread over pages that each stay inside Discord's limits.
 */

import { SlashCommandBuilder, type APIEmbedField } from "discord.js";
import {
  chunkLines,
  createEmbed,
  createPaginationButtons,
  handlePagination,
  paginateFields,
  reservedLength,
} from "../../utils/embeds/embedUtils.js";
import { getModList, type ModInfo } from "@mcbot/core/utils/minecraft/modUtils.js";
import { readThrough } from "@mcbot/core/utils/wrapper/lastKnown.js";
import { withErrorHandling } from "../middleware.js";
import { relativeTimestamp } from "../../utils/discordTime.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { requireCapability } from "@mcbot/core/utils/server/capabilities.js";
import { t } from "@mcbot/core/utils/i18n.js";

/** One or more fields per group; continuation fields repeat the group name. */
function groupFields(label: string, mods: ModInfo[]): APIEmbedField[] {
  if (mods.length === 0) return [];
  const name = t("mods.group", { label, count: mods.length });
  return chunkLines(mods.map((m) => `[${m.name}](${m.url})`)).map((value) => ({
    name,
    value,
    inline: false,
  }));
}

export const data = new SlashCommandBuilder()
  .setName("mods")
  .setDescription(
    "List all installed server mods, grouped by client-side requirement",
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);

  requireCapability(server, (c) => c.modManifest, t("capability.feature.modManifest"));

  // Read through the shared last-known cache, so a wrapper blip shows the mod
  // list from the last successful read rather than an error. Same cache the
  // dashboard uses.
  const { value: modList, stale } = await readThrough(
    server.id,
    "modList",
    () => getModList(server),
  );

  const total =
    modList.serverOnly.length +
    modList.clientOptional.length +
    modList.clientAndServer.length;

  const title = t("mods.title", { server: server.id });
  // An old list shown as current is worse than an old list labelled old.
  const description = [
    t("mods.count", { count: total }),
    ...(stale
      ? [t("mods.stale", { age: relativeTimestamp(new Date(stale.asOf).getTime()) })]
      : []),
  ].join("\n");

  const fields = [
    ...groupFields(t("mods.groupBoth"), modList.clientAndServer),
    ...groupFields(t("mods.groupOptional"), modList.clientOptional),
    ...groupFields(t("mods.groupServer"), modList.serverOnly),
  ];
  const embeds = paginateFields(fields, {
    reserved: reservedLength({ title, description }),
  }).map((page) => createEmbed({ title, description }).addFields(page));

  const message = await interaction.editReply({
    embeds: [embeds[0]!],
    components: embeds.length > 1 ? [createPaginationButtons(0, embeds.length)] : [],
  });
  if (embeds.length > 1) await handlePagination(message, interaction, embeds);
});
