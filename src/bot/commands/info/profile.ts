/**
 * /profile — one player card from data the bot already keeps.
 *
 * Pure presentation: player head, linked Discord account, whitelisted-by
 * (whitelist audit), playtime + last-seen (session store), and daily
 * streak (claim store, via the linked Discord user). No new stores, no
 * writes — everything here exists because some other feature tracked it.
 */
import { SlashCommandBuilder, time as discordTime } from "discord.js";
import { createPlayerEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { isValidMcName } from "@mcbot/core/utils/sanitize.js";
import { loadLinkedAccounts } from "@mcbot/core/utils/linkUtils.js";
import { getAuditEntry } from "@mcbot/core/utils/whitelistAudit.js";
import {
  loadSessionStore,
  getServerSessions,
  isOnlineNow,
  totalPlaytimeMs,
} from "@mcbot/core/utils/sessionStore.js";
import {
  loadClaimedStore,
  getServerClaims,
} from "@mcbot/core/utils/dailyStore.js";
import { formatPlaytime } from "@mcbot/core/utils/statUtils.js";
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
  const linked = await loadLinkedAccounts().catch(
    () => ({}) as Record<string, string>,
  );

  let player = interaction.options.getString("player")?.trim();
  if (!player) {
    player = linked[interaction.user.id];
    if (!player) throw new Error(t("profile.noPlayer"));
  }
  if (!isValidMcName(player)) {
    throw new Error(t("common.invalidUsername", { username: player }));
  }

  // Reverse link lookup: which Discord account owns this MC name?
  const lowerPlayer = player.toLowerCase();
  const ownerId = Object.entries(linked).find(
    ([, mc]) => mc.toLowerCase() === lowerPlayer,
  )?.[0];

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

  // An entry with removedBy means the player was later un-whitelisted —
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
      // formatPlaytime takes ticks (20/s), the session store keeps ms.
      lines.push(
        t("profile.playtime", {
          playtime: formatPlaytime((playtime / 1000) * 20),
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
      title: t("profile.title", { player }),
      description: lines.join("\n"),
      color: EmbedColor.Info,
      footer: { text: server.id },
    },
    true,
  );

  await interaction.editReply({ embeds: [embed] });
});
