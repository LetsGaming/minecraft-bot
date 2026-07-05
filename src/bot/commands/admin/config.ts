import { SlashCommandBuilder, codeBlock } from "discord.js";
import { loadConfig, reloadConfig } from "../../../common/config.js";
import { summarizeConfigChanges } from "../../../common/utils/configDiff.js";
import { reconcileServers } from "../../logWatcher/initMinecraftCommands.js";
import { createEmbed, createSuccessEmbed } from "../../utils/embedUtils.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { log } from "../../../common/utils/logger.js";
import { recordAdminAction } from "../../../common/utils/adminAudit.js";

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

/**
 * Redact sensitive values so they can be shown in Discord safely.
 */
function redact(value: string): string {
  if (!value || value.length <= 4) return "••••";
  return value.slice(0, 2) + "•".repeat(value.length - 4) + value.slice(-2);
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
      // instances for removed ones. Changed settings on an existing ID
      // can't be applied live (the instance keeps its original RCON/watcher
      // wiring), so those are reported as restart-required.
      const { added, removed, changed } = await reconcileServers(
        interaction.client,
        cfg,
      );

      log.info("config", `Config reloaded by ${interaction.user.tag}`);

      // Config reload is an operator-level mutation.
      await recordAdminAction({
        action: "config reload",
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        detail:
          [
            added.length > 0 ? `added: ${added.join(",")}` : "",
            removed.length > 0 ? `removed: ${removed.join(",")}` : "",
            changed.length > 0 ? `changed: ${changed.join(",")}` : "",
          ]
            .filter(Boolean)
            .join("; ") || "no server changes",
      });

      const lines = [
        `Servers: ${after.join(", ")}`,
        `Guilds: ${Object.keys(cfg.guilds).length}`,
        `Admins: ${cfg.adminUsers.length}`,
      ];

      if (added.length > 0)
        lines.push(`+ Added (live): ${added.join(", ")}`);
      if (removed.length > 0)
        lines.push(`- Removed (live): ${removed.join(", ")}`);
      if (changed.length > 0) {
        lines.push(
          `⚠ Changed settings on existing server(s) require a restart: ${changed.join(", ")}`,
        );
      }
      for (const change of settingChanges.slice(0, 12)) {
        lines.push(`~ ${change}`);
      }
      if (settingChanges.length > 12) {
        lines.push(`~ …and ${settingChanges.length - 12} more change(s)`);
      }
      if (
        settingChanges.length === 0 &&
        added.length === 0 &&
        removed.length === 0 &&
        changed.length === 0
      ) {
        lines.push("No changes detected.");
      }

      await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            `Config reloaded from disk.\n${codeBlock(lines.join("\n"))}`,
          ),
        ],
      });
      return;
    }

    // ── show ──
    const cfg = loadConfig();

    // Servers overview
    const serverLines = Object.entries(cfg.servers).map(([id, srv]) => {
      const rcon = srv.useRcon
        ? `RCON ${srv.rconHost}:${srv.rconPort}`
        : "screen only";
      return `${id}: ${rcon} (user: ${srv.linuxUser})`;
    });

    // Guild overview
    const guildLines = Object.entries(cfg.guilds).map(([guildId, gcfg]) => {
      const features: string[] = [];
      if (gcfg.statusEmbed?.enabled === true) features.push("status");
      if (gcfg.notifications?.channelId) features.push("notifications");
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
      return `${guildId}${defaultSrv}\n  ${features.length > 0 ? features.join(", ") : "no features configured"}`;
    });

    // Commands overview
    const disabledCmds = Object.entries(cfg.commands)
      .filter(([, v]) => v.enabled === false)
      .map(([k]) => k);

    const embed = createEmbed({
      title: "⚙️ Bot Configuration",
      color: 0x5865f2,
    });

    embed.addFields(
      {
        name: "Token",
        value: codeBlock(redact(cfg.token)),
        inline: true,
      },
      {
        name: "Client ID",
        value: codeBlock(cfg.clientId),
        inline: true,
      },
      {
        name: `Servers (${Object.keys(cfg.servers).length})`,
        value: codeBlock(serverLines.join("\n") || "none"),
        inline: false,
      },
      {
        name: `Guilds (${Object.keys(cfg.guilds).length})`,
        value: codeBlock(guildLines.join("\n") || "none"),
        inline: false,
      },
      {
        name: `Admins (${cfg.adminUsers.length})`,
        value: codeBlock(cfg.adminUsers.map(redact).join(", ") || "none"),
        inline: true,
      },
    );

    if (disabledCmds.length > 0) {
      embed.addFields({
        name: "Disabled Commands",
        value: codeBlock(disabledCmds.join(", ")),
        inline: true,
      });
    }

    embed.addFields(
      {
        name: "TPS Threshold",
        value: `${cfg.tpsWarningThreshold}`,
        inline: true,
      },
      {
        name: "TPS Poll Interval",
        value: `${cfg.tpsPollIntervalMs / 1000}s`,
        inline: true,
      },
      {
        name: "Leaderboard Interval",
        value: cfg.leaderboardInterval,
        inline: true,
      },
    );

    embed.setFooter({
      text: "Use /config reload to apply config.json changes",
    });

    await interaction.editReply({ embeds: [embed] });
  }),
);
