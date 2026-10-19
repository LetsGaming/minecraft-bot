import { SlashCommandBuilder, codeBlock } from "discord.js";
import { loadConfig, reloadConfig } from "@mcbot/core/config.js";
import { beginConfigApply } from "@mcbot/core/utils/server/runtimeHeartbeat.js";
import { summarizeConfigChanges } from "@mcbot/core/utils/config/configDiff.js";
import { reconcileServers } from "../../logWatcher/initMinecraftCommands.js";
import {
  createEmbed,
  createSuccessEmbed,
} from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { log } from "@mcbot/core/utils/logger.js";
import { auditAdminAction } from "../shared/audit.js";

import { t } from "@mcbot/core/utils/i18n.js";
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

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();

    if (sub === "reload") {
      // Snapshot the previous (cached) config before the reload so guild
      // and feature level edits can be summarized in the reply — the
      // reconciler below only reports server additions/removals.
      const before = loadConfig();
      const cfg = reloadConfig();
      const after = Object.keys(cfg.servers);
      const settingChanges = summarizeConfigChanges(before, cfg);

      // Apply server additions/removals to the running bot —
      // create instances + watchers for added IDs, stop watchers and drop
      // instances for removed ones, rebuild those whose settings changed.
      // Only a failed rebuild is reported as restart-required.
      const reportApplied = beginConfigApply();
      const { added, removed, replaced, changed } = await reconcileServers(
        interaction.client,
        cfg,
      );
      reportApplied(changed);

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
        changed.length === 0
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
        const features: string[] = [];
        if (gcfg.statusEmbed?.enabled === true)
          features.push(t("config.featStatus"));
        if (gcfg.notifications?.channelId)
          features.push(t("config.featNotifications"));
        const bridgeList = Array.isArray(gcfg.chatBridge)
          ? gcfg.chatBridge
          : gcfg.chatBridge
            ? [gcfg.chatBridge]
            : [];
        const bridgeCount = bridgeList.filter((b) => b?.channelId).length;
        if (bridgeCount === 1) features.push("chatBridge");
        if (bridgeCount > 1) features.push(`chatBridge ×${bridgeCount}`);
        if (gcfg.leaderboard?.channelId) features.push("leaderboard");
        if (gcfg.downtimeAlerts?.channelId) features.push("downtime");
        if (gcfg.tpsAlerts?.channelId) features.push("tpsAlerts");
        if (gcfg.channelPurge?.channelId) features.push("purge");
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
        value: `${cfg.tpsPollIntervalMs / 1000}s`,
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
