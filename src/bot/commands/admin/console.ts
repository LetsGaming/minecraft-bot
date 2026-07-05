/**
 * /console — admin console access.
 *
 *   tail lines:<n>          the last N log lines (ephemeral), on top of
 *                           the existing tailLog path
 *   live enable|disable     toggle the batched live relay of this
 *                           server's log into the guild's configured
 *                           `console.channelId` (see consoleRelay watcher)
 *
 * Both mutate nothing on the server; live toggles are persisted and land
 * in the admin audit log because a live console in a channel is a real
 * exposure decision.
 */
import { SlashCommandBuilder, codeBlock } from "discord.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { createSuccessEmbed } from "../../utils/embedUtils.js";
import { tailLog } from "../../../common/utils/serverAccess.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";
import { loadConfig } from "../../../common/config.js";
import {
  setConsoleRelay,
  sanitizeLogLine,
} from "../../logWatcher/watchers/consoleRelay.js";
import { t } from "../../../common/utils/i18n.js";

const MAX_TAIL_LINES = 100;
/** Discord embed description cap is 4096; leave fence + margin. */
const MAX_TAIL_CHARS = 3_800;

export const data = new SlashCommandBuilder()
  .setName("console")
  .setDescription("Server console access | Admin only")
  .addSubcommand((sc) =>
    sc
      .setName("tail")
      .setDescription("Show the last N log lines")
      .addIntegerOption((o) =>
        o
          .setName("lines")
          .setDescription(`How many lines (max ${MAX_TAIL_LINES})`)
          .setMinValue(1)
          .setMaxValue(MAX_TAIL_LINES),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sc) =>
    sc
      .setName("live")
      .setDescription("Relay the live server log into the console channel")
      .addStringOption((o) =>
        o
          .setName("mode")
          .setDescription("Turn the live relay on or off")
          .setRequired(true)
          .addChoices(
            { name: "enable", value: "enable" },
            { name: "disable", value: "disable" },
          ),
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const server = resolveServer(interaction);

    if (sub === "tail") {
      const lines = interaction.options.getInteger("lines") ?? 25;
      const raw = await tailLog(server.config, lines);
      const cleaned = raw
        .split("\n")
        .map((l) => sanitizeLogLine(l))
        .filter(Boolean)
        .join("\n");
      const clipped =
        cleaned.length > MAX_TAIL_CHARS
          ? `…\n${cleaned.slice(-MAX_TAIL_CHARS)}`
          : cleaned || t("console.emptyLog");

      await interaction.editReply({
        content: `**${server.id}** — ${t("console.tailTitle", { lines })}\n${codeBlock(clipped)}`,
      });
      return;
    }

    // live enable/disable
    if (!interaction.guild) {
      throw new Error(t("console.guildOnly"));
    }
    const enable = interaction.options.getString("mode", true) === "enable";
    const channelId = loadConfig().guilds[interaction.guild.id]?.console
      ?.channelId;
    if (enable && !channelId) {
      throw new Error(t("console.noChannel"));
    }

    await setConsoleRelay(interaction.guild.id, server.id, enable);
    await recordAdminAction({
      action: enable ? "console live on" : "console live off",
      server: server.id,
      by: interaction.user.tag,
      byId: interaction.user.id,
      guildId: interaction.guild.id,
    });

    await interaction.editReply({
      embeds: [
        createSuccessEmbed(
          enable
            ? t("console.liveEnabled", {
                server: server.id,
                channel: `<#${channelId}>`,
              })
            : t("console.liveDisabled", { server: server.id }),
        ),
      ],
    });
  }),
  { ephemeral: true },
);
