/**
 * /sessions — a player's recent sessions and last-seen on one server.
 *
 * "When was X last online" is the question /whois couldn't answer; this
 * is the full view (per-server session list + recent playtime), while
 * /whois shows a compact cross-server last-seen line.
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { withErrorHandling } from "../middleware.js";
import { isValidMcName } from "../../../common/utils/sanitize.js";
import {
  loadSessionStore,
  getServerSessions,
  isOnlineNow,
  totalPlaytimeMs,
} from "../../../common/utils/sessionStore.js";
import { t } from "../../../common/utils/i18n.js";

const SHOWN_SESSIONS = 10;

export const data = new SlashCommandBuilder()
  .setName("sessions")
  .setDescription("Show a player's recent sessions and last-seen")
  .addStringOption((o) =>
    o
      .setName("player")
      .setDescription("Minecraft username")
      .setRequired(true)
      .setAutocomplete(true),
  )
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const execute = withErrorHandling(async (interaction) => {
  const playerName = interaction.options.getString("player", true);
  if (!isValidMcName(playerName)) {
    throw new Error(t("common.invalidUsername", { username: playerName }));
  }

  const server = resolveServer(interaction);
  const store = await loadSessionStore();
  const entry = getServerSessions(store, server.id)[playerName.toLowerCase()];

  if (!entry || entry.sessions.length === 0) {
    throw new Error(
      t("sessions.none", { player: playerName, server: server.id }),
    );
  }

  const online = isOnlineNow(entry);
  const statusLine = online
    ? t("sessions.onlineNow")
    : entry.lastSeen
      ? t("sessions.lastSeen", {
          when: `<t:${Math.floor(entry.lastSeen / 1000)}:R>`,
        })
      : t("sessions.lastSeenUnknown");

  const embed = createEmbed({
    title: t("sessions.title", { player: entry.name, server: server.id }),
    description: statusLine,
  });

  embed.addFields({
    name: t("sessions.playtime"),
    value: t("sessions.playtimeValue", {
      duration: formatDuration(totalPlaytimeMs(entry)),
      count: entry.sessions.length,
    }),
    inline: false,
  });

  const recent = entry.sessions.slice(-SHOWN_SESSIONS).reverse();
  const lines = recent.map((s) => {
    const start = `<t:${Math.floor(s.joinedAt / 1000)}:f>`;
    if (s.leftAt === null) {
      return `${start} — ${t("sessions.stillOnline")}`;
    }
    return `${start} — ${formatDuration(s.leftAt - s.joinedAt)}`;
  });
  embed.addFields({
    name: t("sessions.recent", { count: recent.length }),
    value: lines.join("\n"),
    inline: false,
  });

  await interaction.editReply({ embeds: [embed] });
});
