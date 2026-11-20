/**
 * /skin show and /skin refresh: the head image the bot uses for a player, and
 * a way to make Discord fetch it again. Without a name it is the caller's own
 * linked account; another player's head is for bot admins.
 */
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import { getLinkedAccount } from "@mcbot/core/utils/stores/linkStore.js";
import { headInfo, refreshHead } from "@mcbot/core/utils/stores/headStore.js";
import { probeHead, type HeadProbe } from "@mcbot/core/utils/minecraft/playerHead.js";
import { MS } from "@mcbot/schema/time.js";
import { createPlayerEmbed } from "../../utils/embeds/embedUtils.js";
import { formatLastSeen } from "../../utils/discordTime.js";
import { isInvokerAdmin } from "../../utils/guild/permissions.js";
import { replyDenied, withErrorHandling } from "../middleware.js";
import { assertMcName } from "../shared/mcName.js";

export const data = new SlashCommandBuilder()
  .setName("skin")
  .setDescription("Show or refresh the head image the bot uses for a player")
  .addSubcommand((s) =>
    s
      .setName("show")
      .setDescription("Show the head and how old the copy at mc-heads is")
      .addStringOption((o) =>
        o.setName("player").setDescription("Minecraft name (default: your linked account)"),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("refresh")
      .setDescription("Make Discord fetch the head again")
      .addStringOption((o) =>
        o.setName("player").setDescription("Minecraft name (default: your linked account)"),
      ),
  );

/** The player to act on, or null when the invoker may not touch that player (already answered). */
async function resolveTarget(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const linked = await getLinkedAccount(interaction.user.id);
  const given = interaction.options.getString("player");
  if (given === null) {
    if (!linked) throw new Error(t("link.notLinked"));
    return linked;
  }
  const name = assertMcName(given);
  const own = linked !== null && linked.toLowerCase() === name.toLowerCase();
  if (!own && !isInvokerAdmin(interaction)) {
    await replyDenied(interaction);
    return null;
  }
  return name;
}

function cacheLine(probe: HeadProbe): string {
  if (!probe.ok) return t("skin.unreachable");
  const bytes = probe.bytes ?? 0;
  if (probe.ageSeconds === null || probe.ageSeconds === 0) return t("skin.cacheFresh", { bytes });
  return t("skin.cacheAge", { age: formatSpan(probe.ageSeconds * MS.second), bytes });
}

function refreshLine(player: string): string {
  const last = headInfo(player);
  if (!last) return t("skin.neverRefreshed");
  const by = /^\d+$/.test(last.by) ? `<@${last.by}>` : last.by;
  return t("skin.lastRefresh", { when: formatLastSeen(last.refreshedAt), by });
}

export const execute = withErrorHandling(
  async (interaction) => {
    const player = await resolveTarget(interaction);
    if (player === null) return;

    const refreshing = interaction.options.getSubcommand() === "refresh";
    if (refreshing) refreshHead(player, interaction.user.id);
    const probe = await probeHead(player);

    const lines = [
      refreshing ? t("skin.refreshed") : t("skin.hint"),
      cacheLine(probe),
      refreshLine(player),
    ];
    await interaction.editReply({
      embeds: [
        createPlayerEmbed(player, {
          asThumbnail: true,
          title: t("skin.title", { player }),
          description: lines.join("\n"),
        }),
      ],
    });
  },
  { ephemeral: true },
);
