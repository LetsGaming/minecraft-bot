/**
 * /whois <username> (admin) — shows the whitelist audit trail for a
 * Minecraft username (who added/removed it, when, on which server) and the
 * linked Discord account, in one place. Wires up the previously unused
 * getAuditEntry().
 */
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { getAuditEntry } from "../../utils/whitelistAudit.js";
import { loadLinkedAccounts } from "../../utils/linkUtils.js";
import { isValidMcName } from "../../utils/sanitize.js";
import { t } from "../../utils/i18n.js";

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

    const [audit, linked] = await Promise.all([
      getAuditEntry(username),
      loadLinkedAccounts().catch(() => ({}) as Record<string, string>),
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

    await interaction.editReply({ embeds: [embed] });
  }),
  { ephemeral: true },
);
