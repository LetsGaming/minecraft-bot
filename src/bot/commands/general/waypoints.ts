/**
 * /waypoints — read-only Discord view of a server's community waypoints.
 *
 * The Discord side doubles as the server's point-of-interest wiki: full
 * list, paginated with the existing pagination helper, one field per
 * waypoint with coordinates, dimension, author, and age.
 */
import { SlashCommandBuilder } from "discord.js";
import type { EmbedBuilder } from "discord.js";
import {
  createEmbed,
  createPaginationButtons,
  handlePagination,
} from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
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
  const pages: EmbedBuilder[] = [];
  for (let i = 0; i < waypoints.length; i += PER_PAGE) {
    const slice = waypoints.slice(i, i + PER_PAGE);
    const embed = createEmbed({
      title: t("waypoint.embedTitle", { server: serverId }),
      footer: {
        text: t("waypoint.embedFooter", {
          page: Math.floor(i / PER_PAGE) + 1,
          pages: Math.ceil(waypoints.length / PER_PAGE),
          count: waypoints.length,
        }),
      },
    });
    embed.addFields(
      slice.map((wp) => ({
        name: `📍 ${wp.name}${wp.category ? ` — ${wp.category}` : ""}`,
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
    );
    pages.push(embed);
  }
  return pages;
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

  const pages = buildPages(waypoints, server.id);
  const message = await interaction.editReply({
    embeds: [pages[0]!],
    components:
      pages.length > 1 ? [createPaginationButtons(0, pages.length)] : [],
  });
  if (pages.length > 1) {
    await handlePagination(message, interaction, pages);
  }
});
