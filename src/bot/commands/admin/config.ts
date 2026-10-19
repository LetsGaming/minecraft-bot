import { SlashCommandBuilder, codeBlock } from "discord.js";
import { loadConfig } from "@mcbot/core/config.js";
import { applyConfig } from "../../utils/applyConfig.js";
import {
  createEmbed,
  createSuccessEmbed,
} from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { log } from "@mcbot/core/utils/logger.js";
import { auditAdminAction } from "../shared/audit.js";
import { bridgesOf } from "@mcbot/core/utils/server/guildScopes.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";
import { GUILD_FEATURE_KEYS } from "@mcbot/schema";
import { t } from "@mcbot/core/utils/i18n.js";
import { MS } from "@mcbot/schema/time.js";

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("View or reload the bot configuration")
  .addSubcommand((sub) =>
    sub
      .setName("show")
      .setDescription("Show the current running configuration"),
  )
  .addSubcommand((sub) =>
    sub
      .setName("reload")
      .setDescription("Reload config.json from disk (hot-reload)"),
  );

/** Wrapper URLs can embed credentials or internal paths; only the host is shown. */
function hostOnly(apiUrl: string): string {
  try {
    return new URL(apiUrl).host;
  } catch {
    return "?";
  }
}

/** A feature is on when its block is present; the status embed only when explicitly enabled. */
function enabledFeatureLabels(guild: GuildConfig): string[] {
  return GUILD_FEATURE_KEYS.flatMap((key) => {
    const label = t(`config.feat.${key}`);
    if (key === "chatBridge") {
      const count = bridgesOf(guild).filter((b) => b?.channelId).length;
      return count === 0 ? [] : [count === 1 ? label : `${label} ×${count}`];
    }
    if (guild[key] === undefined || guild[key] === null) return [];
    if (key === "statusEmbed" && guild.statusEmbed?.enabled !== true) return [];
    return [label];
  });
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();

    if (sub === "reload") {
      // Only a failed rebuild is reported as restart-required.
      const { config: cfg, settingChanges, added, removed, replaced, changed, failed } =
        await applyConfig(interaction.client);
      const after = Object.keys(cfg.servers);

      log.info("config", `Config reloaded by ${interaction.user.tag}`);

      // Config reload is an operator-level mutation.
      await auditAdminAction(interaction, {
        action: "config reload",
        detail:
          [
            added.length > 0 ? `added: ${added.join(",")}` : "",
            removed.length > 0 ? `removed: ${removed.join(",")}` : "",
            replaced.length > 0 ? `rebuilt: ${replaced.join(",")}` : "",
            changed.length > 0 ? `changed: ${changed.join(",")}` : "",
            failed.length > 0 ? `failed: ${failed.join(",")}` : "",
          ]
            .filter(Boolean)
            .join("; ") || "no server changes",
      });

      const lines = [
        t("config.sumServers", { servers: after.join(", ") }),
        t("config.sumGuilds", { count: Object.keys(cfg.guilds).length }),
        t("config.sumAdmins", { count: cfg.adminUsers.length }),
      ];

      if (added.length > 0)
        lines.push(t("config.added", { list: added.join(", ") }));
      if (removed.length > 0)
        lines.push(t("config.removed", { list: removed.join(", ") }));
      if (replaced.length > 0)
        lines.push(t("config.rebuilt", { list: replaced.join(", ") }));
      if (failed.length > 0)
        lines.push(t("config.failed", { list: failed.join(", ") }));
      if (changed.length > 0) {
        lines.push(t("config.needsRestart", { list: changed.join(", ") }));
      }
      for (const change of settingChanges.slice(0, 12)) {
        lines.push(`~ ${change}`);
      }
      if (settingChanges.length > 12) {
        lines.push(
          t("config.moreChanges", { count: settingChanges.length - 12 }),
        );
      }
      if (
        settingChanges.length === 0 &&
        added.length === 0 &&
        removed.length === 0 &&
        replaced.length === 0 &&
        changed.length === 0 &&
        failed.length === 0
      ) {
        lines.push(t("config.noChanges"));
      }

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            t("config.reloaded", { details: codeBlock(lines.join("\n")) }),
            { title: t("config.reloadedTitle") },
          ),
        ],
      });
      return;
    }

    // ── show ──
    const cfg = loadConfig();

    // Servers overview
    const serverLines = Object.entries(cfg.servers).map(
      ([id, srv]) => `${id}: ${hostOnly(srv.apiUrl)}`,
    );

    // Only the guild the command ran in; other guilds' setups stay private.
    const currentGuildId = interaction.guild?.id;
    const guildLines = Object.entries(cfg.guilds)
      .filter(([guildId]) => guildId === currentGuildId)
      .map(([guildId, gcfg]) => {
        const features = enabledFeatureLabels(gcfg);
        const defaultSrv = gcfg.defaultServer ? ` → ${gcfg.defaultServer}` : "";
        return `${guildId}${defaultSrv}\n  ${features.length > 0 ? features.join(", ") : t("config.noFeatures")}`;
      });

    // Commands overview
    const disabledCmds = Object.entries(cfg.commands)
      .filter(([, v]) => v.enabled === false)
      .map(([k]) => k);

    const embed = createEmbed({
      title: t("config.title"),
      color: EmbedColor.Info,
    });

    embed.addFields(
      {
        name: t("config.fieldClientId"),
        value: codeBlock(cfg.clientId),
        inline: true,
      },
      {
        name: t("config.fieldServers", {
          count: Object.keys(cfg.servers).length,
        }),
        value: codeBlock(serverLines.join("\n") || t("config.none")),
        inline: false,
      },
      {
        name: t("config.fieldGuild"),
        value: codeBlock(guildLines.join("\n") || t("config.none")),
        inline: false,
      },
      {
        name: t("config.fieldAdmins"),
        value: String(cfg.adminUsers.length),
        inline: true,
      },
    );

    if (disabledCmds.length > 0) {
      embed.addFields({
        name: t("config.fieldDisabled"),
        value: codeBlock(disabledCmds.join(", ")),
        inline: true,
      });
    }

    embed.addFields(
      {
        name: t("config.fieldTpsThreshold"),
        value: `${cfg.tpsWarningThreshold}`,
        inline: true,
      },
      {
        name: t("config.fieldTpsInterval"),
        value: `${cfg.tpsPollIntervalMs / MS.second}s`,
        inline: true,
      },
      {
        name: t("config.fieldLeaderboardInterval"),
        value: cfg.leaderboardInterval,
        inline: true,
      },
    );

    embed.setFooter({
      text: t("config.footer"),
    });

    await interaction.editReply({ embeds: [embed] });
  }),
  { ephemeral: true },
);
