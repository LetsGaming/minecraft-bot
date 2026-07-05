/**
 * /whois <username> (admin) — shows the whitelist audit trail for a
 * Minecraft username (who added/removed it, when, on which server) and the
 * linked Discord account, in one place. Wires up the previously unused
 * getAuditEntry().
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { getAuditEntry } from "../../../common/utils/whitelistAudit.js";
import { loadLinkedAccounts } from "../../../common/utils/linkUtils.js";
import { isValidMcName } from "../../../common/utils/sanitize.js";
import {
  loadSessionStore,
  isOnlineNow,
  type SessionStore,
} from "../../../common/utils/sessionStore.js";
import {
  loadNotesStore,
  getNotesByUuid,
  findNotesByName,
  type PlayerNotesStore,
} from "../../../common/utils/noteStore.js";
import { t } from "../../../common/utils/i18n.js";

/**
 * Most recent activity for a name across every server's session data:
 * "online now on <id>" wins, otherwise the newest lastSeen.
 */
function crossServerLastSeen(
  store: SessionStore,
  username: string,
): { text: string } | null {
  const lower = username.toLowerCase();
  let latest: { server: string; at: number } | null = null;
  for (const [serverId, players] of Object.entries(store.servers)) {
    const entry = players[lower];
    if (!entry) continue;
    if (isOnlineNow(entry)) {
      return { text: t("whois.onlineNow", { server: serverId }) };
    }
    if (entry.lastSeen && (!latest || entry.lastSeen > latest.at)) {
      latest = { server: serverId, at: entry.lastSeen };
    }
  }
  if (!latest) return null;
  return {
    text: t("whois.lastSeenValue", {
      when: `<t:${Math.floor(latest.at / 1000)}:R>`,
      server: latest.server,
    }),
  };
}

function notesFor(
  store: PlayerNotesStore,
  uuid: string | undefined,
  username: string,
): string | null {
  const entry =
    (uuid ? getNotesByUuid(store, uuid) : null) ??
    findNotesByName(store, username)?.entry ??
    null;
  if (!entry || entry.notes.length === 0) return null;
  const SHOWN = 5;
  const lines = entry.notes
    .slice(-SHOWN)
    .map((n, i, arr) => {
      const index = entry.notes.length - arr.length + i + 1;
      return `**${index}.** [${n.createdAt}] ${n.author}: ${n.text}`;
    });
  if (entry.notes.length > SHOWN) {
    lines.push(t("whois.moreNotes", { more: entry.notes.length - SHOWN }));
  }
  return lines.join("\n");
}

export const data = new SlashCommandBuilder()
  .setName("whois")
  .setDescription("Show whitelist audit info and linked Discord account")
  .addStringOption((o) =>
    o
      .setName("username")
      .setDescription("Minecraft username")
      .setRequired(true),
  );

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const username = interaction.options.getString("username", true);

    if (!isValidMcName(username)) {
      throw new Error(t("common.invalidUsername", { username }));
    }

    const [audit, linked, sessions, notesStore] = await Promise.all([
      getAuditEntry(username),
      loadLinkedAccounts().catch(() => ({}) as Record<string, string>),
      loadSessionStore().catch(
        (): SessionStore => ({ version: 1, servers: {} }),
      ),
      loadNotesStore().catch(
        (): PlayerNotesStore => ({ version: 1, players: {} }),
      ),
    ]);

    // Reverse lookup: which Discord account linked this Minecraft name?
    const lower = username.toLowerCase();
    const linkedDiscordId =
      Object.entries(linked).find(
        ([, mcName]) => mcName.toLowerCase() === lower,
      )?.[0] ?? null;

    if (!audit && !linkedDiscordId) {
      throw new Error(t("whois.noData", { username }));
    }

    const embed = createEmbed({
      title: `🔎 ${t("whois.title", { username: audit?.username ?? username })}`,
    });

    if (audit?.addedBy) {
      embed.addFields(
        {
          name: t("whois.addedBy"),
          value: `${audit.addedBy} (<@${audit.addedById}>)`,
          inline: true,
        },
        { name: t("whois.addedAt"), value: audit.addedAt ?? "—", inline: true },
        { name: t("whois.server"), value: audit.server ?? "—", inline: true },
      );
    }
    if (audit?.uuid) {
      embed.addFields({
        name: t("whois.uuid"),
        value: `\`${audit.uuid}\``,
        inline: false,
      });
    }
    if (audit?.removedBy) {
      embed.addFields(
        {
          name: t("whois.removedBy"),
          value: `${audit.removedBy} (<@${audit.removedById}>)`,
          inline: true,
        },
        {
          name: t("whois.removedAt"),
          value: audit.removedAt ?? "—",
          inline: true,
        },
      );
    }
    embed.addFields({
      name: t("whois.linkedAccount"),
      value: linkedDiscordId ? `<@${linkedDiscordId}>` : t("whois.notLinked"),
      inline: false,
    });

    const lastSeen = crossServerLastSeen(sessions, username);
    if (lastSeen) {
      embed.addFields({
        name: t("whois.lastSeen"),
        value: lastSeen.text,
        inline: false,
      });
    }

    const notes = notesFor(notesStore, audit?.uuid ?? undefined, username);
    if (notes) {
      embed.addFields({
        name: t("whois.notes"),
        value: notes,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  }),
  { ephemeral: true },
);
