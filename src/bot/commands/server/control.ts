import { SlashCommandBuilder } from "discord.js";
import {
  createEmbed,
  createErrorEmbed,
  createSuccessEmbed,
} from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { suppressAlerts } from "../../logWatcher/watchers/monitors/downtimeMonitor.js";
import { log } from "@mcbot/core/utils/logger.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import * as serverAccess from "@mcbot/core/utils/server/serverAccess.js";
import { requireCapability } from "@mcbot/core/utils/server/capabilities.js";
import { loadAllStats } from "@mcbot/core/utils/minecraft/statUtils.js";
import { deleteStats } from "@mcbot/core/utils/minecraft/statUtils.js";
import { loadWhitelist } from "@mcbot/core/utils/minecraft/whitelist.js";
import { isDisruptiveServerAction } from "@mcbot/schema/serverActions.js";

/**
 * Script paths relative to the scripts directory.
 * Matches the minecraft-server-setup project layout:
 *   {scriptDir}/
 *     start.sh
 *     shutdown.sh
 *     smart_restart.sh
 *     backup/backup.sh
 *     misc/status.sh
 */
export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Server control commands")
  .addSubcommand((sub) =>
    sub
      .setName("start")
      .setDescription("Start the Minecraft server")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("Stop the server (30s countdown)")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("restart")
      .setDescription("Restart the server (30s countdown)")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("backup")
      .setDescription("Create a server backup")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      )
      .addBooleanOption((o) =>
        o
          .setName("archive")
          .setDescription("Create an archive backup instead of hourly"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Get detailed server status via script")
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("prune-stats")
      .setDescription(
        "Delete stats files of players no longer on the whitelist",
      )
      .addStringOption((o) =>
        o
          .setName("server")
          .setDescription("Server instance")
          .setAutocomplete(true),
      )
      .addBooleanOption((o) =>
        o
          .setName("confirm")
          .setDescription("Set to true to actually delete (otherwise dry run)"),
      ),
  );

const LABELS: Record<string, { verb: string; emoji: string; past: string }> = {
  start: { verb: "Starting", emoji: "🟢", past: "started" },
  stop: { verb: "Stopping", emoji: "🔴", past: "stopped" },
  restart: { verb: "Restarting", emoji: "🔄", past: "restarted" },
  backup: { verb: "Backing up", emoji: "💾", past: "backup complete" },
  status: { verb: "Checking", emoji: "ℹ️", past: "status retrieved" },
};

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const server = resolveServer(interaction);

    if (!server) throw new Error("Server not found.");

    log.info("control", `${interaction.user.tag} → /${sub} on ${server.id}`);

    // Persistent audit trail of admin server actions.
    // "status" is read-only and skipped; prune-stats records its mode.
    if (sub !== "status") {
      await recordAdminAction({
        action: `server ${sub}`,
        server: server.id,
        by: interaction.user.tag,
        byId: interaction.user.id,
        guildId: interaction.guild?.id ?? null,
        ...(sub === "prune-stats"
          ? {
              detail:
                interaction.options.getBoolean("confirm") === true
                  ? "confirmed"
                  : "dry-run",
            }
          : {}),
      });
    }

    // Script-based subcommands need the corresponding management
    // script from the setup suite. Gate here with a documented error
    // instead of letting runScript fail with a raw "Script not found"
    // path. prune-stats is suite-independent and never gated.
    if (sub !== "prune-stats") {
      requireCapability(
        server,
        (c) => c.scripts[sub as keyof typeof c.scripts] === true,
        `the \`${sub}\` management script`,
      );
    }

    // Suppress downtime alerts for intentional stop/restart
    if (isDisruptiveServerAction(sub)) {
      suppressAlerts(server.id);
    }

    // Explicit, admin-gated replacement for the automatic stats
    // cleanup that buildLeaderboard used to perform as a hidden side effect.
    // Dry run by default — lists what would be deleted; confirm:true deletes.
    if (sub === "prune-stats") {
      const whitelist = (await loadWhitelist(true, server)) ?? [];
      if (whitelist.length === 0) {
        throw new Error(
          "Whitelist is empty or could not be loaded — refusing to prune (this would delete every player's stats).",
        );
      }
      const known = new Set(whitelist.map((p) => p.uuid));
      const allStats = await loadAllStats(server);
      const orphans = Object.keys(allStats).filter((uuid) => !known.has(uuid));

      if (orphans.length === 0) {
        return void (await interaction.editReply({
          embeds: [
            createSuccessEmbed(
              `No orphaned stats files on **${server.id}** — nothing to prune.`,
            ),
          ],
        }));
      }

      const confirmed = interaction.options.getBoolean("confirm") === true;
      if (!confirmed) {
        return void (await interaction.editReply({
          embeds: [
            createEmbed({
              title: `🧹 Prune stats — dry run (${server.id})`,
              description:
                `${orphans.length} stats file(s) belong to players not on the whitelist:\n` +
                `\`\`\`\n${orphans.slice(0, 20).join("\n")}${orphans.length > 20 ? "\n..." : ""}\n\`\`\`\n` +
                `Re-run with \`confirm: true\` to delete them permanently.`,
              color: EmbedColor.Warning,
            }),
          ],
        }));
      }

      let deletedCount = 0;
      for (const uuid of orphans) {
        if (await deleteStats(uuid, server)) deletedCount++;
      }
      log.info(
        "control",
        `prune-stats: ${interaction.user.tag} deleted ${deletedCount}/${orphans.length} stats file(s) on ${server.id}`,
      );
      return void (await interaction.editReply({
        embeds: [
          createSuccessEmbed(
            `Deleted ${deletedCount} orphaned stats file(s) on **${server.id}**.`,
          ),
        ],
      }));
    }

    // Status is read-only and fast — no progress embed needed
    if (sub === "status") {
      const result = await serverAccess.runScript(server.config, sub);
      const embed = createEmbed({
        title: `Server Status — ${server.id}`,
        description: `\`\`\`\n${result.output || "No output"}\n\`\`\``,
      });
      return void (await interaction.editReply({ embeds: [embed] }));
    }

    // Mutating commands: show progress, then run
    const label = LABELS[sub]!;
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: `${label.emoji} ${label.verb} — ${server.id}`,
          description:
            sub === "start"
              ? "Executing start script..."
              : "This may take up to 40 seconds (countdown + save)...",
          color: EmbedColor.Warning,
        }),
      ],
    });

    // Build args
    const args: string[] = [];
    if (sub === "backup" && interaction.options.getBoolean("archive")) {
      args.push("--archive");
    }

    const result = await serverAccess.runScript(server.config, sub, args);

    if (result.exitCode !== 0) {
      const errMsg =
        result.stderr || result.output || `Exited with code ${result.exitCode}`;
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            `**${sub}** failed on **${server.id}**\n\`\`\`\n${errMsg.slice(0, 1000)}\n\`\`\``,
          ),
        ],
      });
      return;
    }

    const successEmbed = createSuccessEmbed(`**${server.id}** — ${label.past}`);

    if (result.output && result.output.length > 0 && sub !== "start") {
      const output =
        result.output.length > 1000
          ? result.output.slice(-1000) + "..."
          : result.output;
      successEmbed.setDescription(
        `**${server.id}** — ${label.past}\n\`\`\`\n${output}\n\`\`\``,
      );
    }

    await interaction.editReply({ embeds: [successEmbed] });
  }),
);
