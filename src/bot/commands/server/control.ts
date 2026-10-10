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
import { t } from "@mcbot/core/utils/i18n.js";

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

const LABEL_EMOJI: Record<string, string> = {
  start: "🟢",
  stop: "🔴",
  restart: "🔄",
  backup: "💾",
  status: "ℹ️",
};

function actionLabel(sub: string): { verb: string; emoji: string; past: string } {
  return {
    verb: t(`control.verb.${sub}`),
    emoji: LABEL_EMOJI[sub] ?? "",
    past: t(`control.past.${sub}`),
  };
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    const server = resolveServer(interaction);

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
        throw new Error(t("control.pruneNoWhitelist"));
      }
      const known = new Set(whitelist.map((p) => p.uuid));
      const allStats = await loadAllStats(server);
      const orphans = Object.keys(allStats).filter((uuid) => !known.has(uuid));

      if (orphans.length === 0) {
        return void (await interaction.editReply({
          embeds: [
            createSuccessEmbed(t("control.pruneNone", { server: server.id })),
          ],
        }));
      }

      const confirmed = interaction.options.getBoolean("confirm") === true;
      if (!confirmed) {
        return void (await interaction.editReply({
          embeds: [
            createEmbed({
              title: t("control.pruneDryTitle", { server: server.id }),
              description: t("control.pruneDryBody", {
                count: orphans.length,
                list: `${orphans.slice(0, 20).join("\n")}${orphans.length > 20 ? "\n..." : ""}`,
              }),
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
            t("control.pruned", { count: deletedCount, server: server.id }),
          ),
        ],
      }));
    }

    // Status is read-only and fast — no progress embed needed
    if (sub === "status") {
      const result = await serverAccess.runScript(server.config, sub);
      const embed = createEmbed({
        title: t("status.title", { server: server.id }),
        description: `\`\`\`\n${result.output || t("control.noOutput")}\n\`\`\``,
      });
      return void (await interaction.editReply({ embeds: [embed] }));
    }

    // Mutating commands: show progress, then run
    const label = actionLabel(sub);
    await interaction.editReply({
      embeds: [
        createEmbed({
          title: t("control.progressTitle", {
            emoji: label.emoji,
            verb: label.verb,
            server: server.id,
          }),
          description:
            sub === "start"
              ? t("control.startRunning")
              : t("control.progressLong"),
          color: EmbedColor.Warning,
        }),
      ],
    });

    // Build args
    const args: string[] = [];
    if (sub === "backup" && interaction.options.getBoolean("archive")) {
      args.push("--archive");
    }

    let result: Awaited<ReturnType<typeof serverAccess.runScript>>;
    try {
      result = await serverAccess.runScript(server.config, sub, args);
    } catch (err) {
      if (err instanceof Error && err.name === "ScriptStillRunningError") {
        await interaction.editReply({
          embeds: [
            createEmbed({
              title: `${label.emoji} ${label.verb}: ${server.id}`,
              description: t("control.stillRunning", {
                action: sub,
                server: server.id,
              }),
              color: EmbedColor.Warning,
            }),
          ],
        });
        return;
      }
      throw err;
    }

    if (result.exitCode !== 0) {
      const errMsg =
        result.stderr ||
        result.output ||
        t("control.exitCode", { code: result.exitCode });
      await interaction.editReply({
        embeds: [
          createErrorEmbed(
            `${t("control.failed", { action: sub, server: server.id })}\n\`\`\`\n${errMsg.slice(0, 1000)}\n\`\`\``,
          ),
        ],
      });
      return;
    }

    const successEmbed = createSuccessEmbed(
      t("control.done", { server: server.id, past: label.past }),
    );

    if (result.output && result.output.length > 0 && sub !== "start") {
      const output =
        result.output.length > 1000
          ? result.output.slice(-1000) + "..."
          : result.output;
      successEmbed.setDescription(
        `${t("control.done", { server: server.id, past: label.past })}\n\`\`\`\n${output}\n\`\`\``,
      );
    }

    await interaction.editReply({ embeds: [successEmbed] });
  }),
);
