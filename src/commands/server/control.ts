import { SlashCommandBuilder } from "discord.js";
import {
  createEmbed,
  createErrorEmbed,
  createSuccessEmbed,
} from "../../utils/embedUtils.js";
import { resolveServer } from "../../utils/guildRouter.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { suppressAlerts } from "../../logWatcher/watchers/downtimeMonitor.js";
import { log } from "../../utils/logger.js";
import * as serverAccess from "../../utils/serverAccess.js";

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

    // Suppress downtime alerts for intentional stop/restart
    if (sub === "stop" || sub === "restart") {
      suppressAlerts(server.id);
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
          color: 0xffaa00,
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
