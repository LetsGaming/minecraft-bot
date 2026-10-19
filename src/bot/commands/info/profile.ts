/**
 * /profile: one player card from data the bot already keeps.
 *
 * Pure presentation: player head, linked Discord account, whitelisted-by
 * (whitelist audit), playtime + last-seen (session store), and daily
 * streak (claim store, via the linked Discord user). No new stores, no
 * writes, everything here exists because some other feature tracked it.
 */
import { SlashCommandBuilder, time as discordTime } from "discord.js";
import { createPlayerEmbed } from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { assertMcName } from "../shared/mcName.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "@mcbot/core/utils/stores/linkStore.js";
import { getAuditEntry } from "@mcbot/core/utils/stores/whitelistAudit.js";
import {
  loadSessionStore,
  getServerSessions,
  isOnlineNow,
  totalPlaytimeMs,
} from "@mcbot/core/utils/stores/sessionStore.js";
import {
  loadClaimedStore,
  getServerClaims,
} from "@mcbot/core/utils/stores/dailyStore.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import { t } from "@mcbot/core/utils/i18n.js";

export const data = new SlashCommandBuilder()
  .setName("profile")
  .setDescription("Player card: link, whitelist, playtime, streak")
  .addStringOption((o) =>
    o
      .setName("player")
      .setDescription("Minecraft username (default: your linked account)")
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

export const execute = withErrorHandling(async (interaction) => {
  const server = resolveServer(interaction);
  const linked = await loadLinkedAccountsOrEmpty();

  const requested = interaction.options.getString("player")?.trim();
  const own = linked[interaction.user.id];
  if (!requested && !own) throw new Error(t("profile.noPlayer"));
  const player = assertMcName(requested || own || "");

  // Reverse link lookup: which Discord account owns this MC name?
  const ownerId = findDiscordIdByMcName(linked, player);
  const lowerPlayer = player.toLowerCase(); // session store is keyed lowercase

  const [audit, sessions, claims] = await Promise.all([
    getAuditEntry(player).catch(() => null),
    loadSessionStore().then((s) => {
      const entry = getServerSessions(s, server.id)[lowerPlayer];
      return entry ?? null;
    }),
    ownerId
      ? loadClaimedStore().then(
          (s) => getServerClaims(s, server.id)[ownerId] ?? null,
        )
      : Promise.resolve(null),
  ]);

  const lines: string[] = [];

  lines.push(
    ownerId
      ? t("profile.linked", { mention: `<@${ownerId}>` })
      : t("profile.notLinked"),
  );

  // An entry with removedBy means the player was later un-whitelisted ,
  // showing "whitelisted by X" for them would be wrong, so skip it.
  if (audit?.addedBy && audit.addedAt && !audit.removedBy) {
    lines.push(
      t("profile.whitelisted", {
        by: audit.addedBy,
        at: audit.addedAt,
      }),
    );
  }

  if (sessions) {
    const playtime = totalPlaytimeMs(sessions);
    if (playtime > 0) {
      lines.push(
        t("profile.playtime", {
          playtime: formatSpan(playtime),
          sessions: sessions.sessions.length,
        }),
      );
    }
    if (isOnlineNow(sessions)) {
      lines.push(t("profile.onlineNow"));
    } else if (sessions.lastSeen) {
      lines.push(
        t("profile.lastSeen", {
          when: discordTime(Math.floor(sessions.lastSeen / 1000), "R"),
        }),
      );
    }
  }

  if (claims) {
    lines.push(
      t("profile.streak", {
        current: claims.currentStreak,
        longest: claims.longestStreak,
      }),
    );
  }

  if (lines.length === 0) {
    lines.push(t("profile.nothingKnown"));
  }

  const embed = createPlayerEmbed(
    player,
    {
      title: t("profile.title", { player, server: server.id }),
      description: lines.join("\n"),
      color: EmbedColor.Info,
      asThumbnail: true,
    },
  );

  await interaction.editReply({ embeds: [embed] });
});
