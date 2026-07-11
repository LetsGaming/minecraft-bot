/**
 * /watch — one-shot personal notifications.
 *
 *   /watch server [server]          DM me when this server is back online
 *   /watch player player:<name>     DM me when this player joins
 *   /watch list                     my active watches
 *   /watch remove id:<id>           drop one
 *
 * Watches fire once and remove themselves (watchStore); the downtime
 * monitor and the join watcher do the firing. DMs must be open — the
 * reply says so, since a watch that can't deliver is worthless.
 */
import { SlashCommandBuilder } from "discord.js";
import { withErrorHandling } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { createSuccessEmbed, createEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import {
  loadWatchStore,
  saveWatchStore,
  newWatchId,
  MAX_WATCHES_PER_USER,
} from "@mcbot/core/utils/watchStore.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { t } from "@mcbot/core/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("watch")
  .setDescription("One-shot DM when a server recovers or a player joins")
  .addSubcommand((sc) =>
    sc
      .setName("server")
      .setDescription("DM me once when this server is back online")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("player")
      .setDescription("DM me once when this player joins")
      .addStringOption((o) =>
        o
          .setName("player")
          .setDescription("Minecraft username")
          .setRequired(true)
          .setAutocomplete(true),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc.setName("list").setDescription("Show your active watches"),
  )
  .addSubcommand((sc) =>
    sc
      .setName("remove")
      .setDescription("Remove one of your watches")
      .addStringOption((o) =>
        o
          .setName("id")
          .setDescription("Watch ID from /watch list")
          .setRequired(true),
      ),
  );

export const execute = withErrorHandling(
  async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const store = await loadWatchStore();
    const mine = store.watches.filter((w) => w.userId === interaction.user.id);

    if (sub === "list") {
      const lines = mine.map((w) =>
        w.kind === "server"
          ? t("watch.listServer", { id: w.id, server: w.serverId })
          : t("watch.listPlayer", {
              id: w.id,
              player: w.player ?? "?",
              server: w.serverId,
            }),
      );
      const embed = createEmbed({
        title: t("watch.listTitle"),
        description: lines.length > 0 ? lines.join("\n") : t("watch.listNone"),
        color: EmbedColor.Info,
      });
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (sub === "remove") {
      const id = interaction.options.getString("id", true).trim();
      const watch = mine.find((w) => w.id === id);
      if (!watch) throw new Error(t("watch.notFound", { id }));
      store.watches = store.watches.filter((w) => w !== watch);
      await saveWatchStore(store);
      await interaction.editReply({
        embeds: [createSuccessEmbed(t("watch.removed", { id }))],
      });
      return;
    }

    // server / player subscribe
    if (mine.length >= MAX_WATCHES_PER_USER) {
      throw new Error(t("watch.limit", { max: MAX_WATCHES_PER_USER }));
    }
    const server = resolveServer(interaction);

    if (sub === "player") {
      const player = interaction.options.getString("player", true).trim();
      if (!isValidMcName(player)) {
        throw new Error(t("common.invalidUsername", { username: player }));
      }
      const lower = player.toLowerCase();
      if (
        mine.some(
          (w) =>
            w.kind === "player" &&
            w.serverId === server.id &&
            w.player === lower,
        )
      ) {
        throw new Error(t("watch.duplicate"));
      }
      store.watches.push({
        id: newWatchId(),
        userId: interaction.user.id,
        kind: "player",
        serverId: server.id,
        player: lower,
        createdAt: Date.now(),
      });
      await saveWatchStore(store);
      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            t("watch.playerArmed", { player, server: server.id }),
          ),
        ],
      });
      return;
    }

    // server
    if (mine.some((w) => w.kind === "server" && w.serverId === server.id)) {
      throw new Error(t("watch.duplicate"));
    }
    store.watches.push({
      id: newWatchId(),
      userId: interaction.user.id,
      kind: "server",
      serverId: server.id,
      createdAt: Date.now(),
    });
    await saveWatchStore(store);
    await interaction.editReply({
      embeds: [
        createSuccessEmbed(t("watch.serverArmed", { server: server.id })),
      ],
    });
  },
  { ephemeral: true },
);
