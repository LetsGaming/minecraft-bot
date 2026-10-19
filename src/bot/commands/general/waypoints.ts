/**
 * /waypoints: read-only Discord view of a server's community waypoints, one
 * field per waypoint with coordinates, dimension, author, and age.
 */
import { SlashCommandBuilder } from "discord.js";
import type { EmbedBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { pageBy, replyPaged } from "../shared/paged.js";
import {
  loadWaypointStore,
  getServerWaypoints,
  type Waypoint,
} from "@mcbot/core/utils/stores/waypointStore.js";
import { t } from "@mcbot/core/utils/i18n.js";

const PER_PAGE = 10;

export const data = new SlashCommandBuilder()
  .setName("waypoints")
  .setDescription("List community waypoints for a server")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  )
  .addStringOption((o) =>
    o
      .setName("category")
      .setDescription("Only show waypoints with this category tag"),
  );

function buildPages(waypoints: Waypoint[], serverId: string): EmbedBuilder[] {
  return pageBy(waypoints, PER_PAGE).map((slice) =>
    createEmbed({
      title: t("waypoint.embedTitle", { server: serverId }),
      description: t("waypoint.count", { count: waypoints.length }),
    }).addFields(
      slice.map((wp) => ({
        name: wp.category ? `${wp.name} (${wp.category})` : wp.name,
        value: t("waypoint.embedEntry", {
          x: wp.x,
          y: wp.y,
          z: wp.z,
          dimension: wp.dimension,
          author: wp.author,
          date: `<t:${Math.floor(wp.createdAt / 1000)}:d>`,
        }),
        inline: false,
      })),
    ),
  );
}

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const category = interaction.options
    .getString("category")
    ?.trim()
    .toLowerCase();
  const store = await loadWaypointStore();
  const waypoints = Object.values(getServerWaypoints(store, server.id))
    .filter((wp) => !category || wp.category === category)
    .sort((a, b) => a.name.localeCompare(b.name));

  if (waypoints.length === 0) {
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: t("waypoint.embedTitle", { server: server.id }),
          description: category
            ? t("waypoint.noneInCategory", { category })
            : t("waypoint.noneDiscord"),
        }),
      ],
    });
    return;
  }

  await replyPaged(interaction, buildPages(waypoints, server.id));
});
