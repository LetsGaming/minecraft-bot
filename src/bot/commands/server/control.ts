import {
  MessageFlags,
  SlashCommandBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type EmbedBuilder,
} from "discord.js";
import {
  createEmbed,
  createErrorEmbed,
  createProgressEmbed,
  createSuccessEmbed,
} from "../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../utils/embeds/embedColors.js";
import { createConfirmEmbed, createConfirmRow } from "../../utils/embeds/confirm.js";
import {
  confirmTarget,
  registerConfirmAction,
  scheduleConfirmExpiry,
} from "../../interactions/confirmActions.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { getOnlinePlayers } from "@mcbot/core/utils/minecraft/playerUtils.js";
import { CommandError } from "@mcbot/core/utils/error.js";
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

type ScriptAction = "start" | "stop" | "restart" | "backup";
type ConfirmedAction = "stop" | "restart";

const CONFIRM_ACTION: Record<ConfirmedAction, string> = {
  stop: "server-stop",
  restart: "server-restart",
};

function needScript(server: ServerInstance, sub: string): void {
  requireCapability(
    server,
    (c) => c.scripts[sub as keyof typeof c.scripts] === true,
    t("capability.feature.script", { script: sub }),
  );
}

async function audit(
  user: { tag: string; id: string },
  guildId: string | null,
  sub: string,
  server: ServerInstance,
  detail?: string,
): Promise<void> {
  await recordAdminAction({
    action: `server ${sub}`,
    server: server.id,
    by: user.tag,
    byId: user.id,
    guildId,
    ...(detail ? { detail } : {}),
  });
}

/**
 * Runs a management script and reports through `show`: a progress embed
 * first, then the outcome. Script output can contain paths, so a failure
 * shows it only to the admin through `showPrivately`.
 */
async function runScriptAction(
  server: ServerInstance,
  sub: ScriptAction,
  args: string[],
  by: string,
  show: (embed: EmbedBuilder) => Promise<unknown>,
  showPrivately: (embed: EmbedBuilder) => Promise<unknown>,
): Promise<void> {
  await show(
    createProgressEmbed({
      title: t(`control.progress.${sub}`, { server: server.id }),
      description: t(`control.progressBody.${sub}`, { user: by }),
    }),
  );

  let result: Awaited<ReturnType<typeof serverAccess.runScript>>;
  try {
    result = await serverAccess.runScript(server.config, sub, args);
  } catch (err) {
    if (err instanceof Error && err.name === "ScriptStillRunningError") {
      await show(
        createEmbed({
          title: t(`control.progress.${sub}`, { server: server.id }),
          description: t("control.stillRunning", { server: server.id }),
          color: EmbedColor.Warning,
        }),
      );
      return;
    }
    throw err;
  }

  if (result.exitCode !== 0) {
    await show(
      createErrorEmbed({
        title: t(`control.failedTitle.${sub}`, { server: server.id }),
        problem: t("control.failed", { code: result.exitCode }),
        recovery: t("control.failedRecovery"),
      }),
    );
    const detail = result.stderr || result.output || t("control.noOutput");
    await showPrivately(
      createErrorEmbed({
        title: t("control.outputTitle"),
        problem: codeBlock(detail.slice(-1000)),
      }),
    );
    return;
  }

  const output =
    result.output && sub !== "start"
      ? `\n${codeBlock(result.output.length > 1000 ? result.output.slice(-1000) : result.output)}`
      : "";
  await show(
    createSuccessEmbed(t(`control.done.${sub}`, { server: server.id }) + output, {
      title: t(`control.doneTitle.${sub}`, { server: server.id }),
    }),
  );
}

function codeBlock(text: string): string {
  return "```\n" + text + "\n```";
}

/** Stop and restart disconnect everyone, so they ask first, ephemerally. */
async function askToConfirm(
  interaction: ChatInputCommandInteraction,
  sub: ConfirmedAction,
): Promise<void> {
  const server = resolveServer(interaction);
  needScript(server, sub);

  const players = await getOnlinePlayers(server).catch(() => null);
  const description =
    players === null
      ? t(`control.confirmBodyUnknown.${sub}`)
      : players.length === 0
        ? t(`control.confirmBodyEmpty.${sub}`)
        : t(`control.confirmBody.${sub}`, { count: players.length });

  const target = confirmTarget(CONFIRM_ACTION[sub], server.id, interaction.user.id);
  await interaction.reply({
    embeds: [
      createConfirmEmbed({
        title: t(`control.confirmTitle.${sub}`, { server: server.id }),
        description,
      }),
    ],
    components: [
      createConfirmRow(target, t(`control.confirmButton.${sub}`, { server: server.id })),
    ],
    flags: MessageFlags.Ephemeral,
  });
  scheduleConfirmExpiry(interaction, target);
}

async function onConfirmed(
  interaction: ButtonInteraction,
  sub: ConfirmedAction,
  serverId: string,
): Promise<void> {
  const server = getServerInstance(serverId);
  if (!server) {
    throw new CommandError({ problem: t("router.serverNotFound", { server: serverId }) });
  }
  needScript(server, sub);

  log.info("control", `${interaction.user.tag} → /server ${sub} on ${server.id} (confirmed)`);
  await audit(interaction.user, interaction.guild?.id ?? null, sub, server);
  suppressAlerts(server.id);

  await interaction.update({
    embeds: [
      createEmbed({
        description: t("control.confirmed", { server: server.id }),
        color: EmbedColor.Pending,
      }),
    ],
    components: [],
  });
  // Public, so the channel knows why the server goes offline.
  const notice = await interaction.followUp({
    embeds: [
      createProgressEmbed({
        title: t(`control.progress.${sub}`, { server: server.id }),
        description: t(`control.progressBody.${sub}`, { user: interaction.user.username }),
      }),
    ],
  });
  await runScriptAction(
    server,
    sub,
    [],
    interaction.user.username,
    (embed) => interaction.webhook.editMessage(notice, { embeds: [embed] }),
    (embed) => interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }),
  );
}

for (const sub of ["stop", "restart"] as const) {
  registerConfirmAction(
    CONFIRM_ACTION[sub],
    (interaction, target) => onConfirmed(interaction, sub, target.serverId),
    { confirmLabelKey: `control.confirmButton.${sub}` },
  );
}

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    if (sub === "stop" || sub === "restart") {
      await askToConfirm(interaction, sub);
      return;
    }

    await interaction.deferReply();
    const server = resolveServer(interaction);
    log.info("control", `${interaction.user.tag} → /${sub} on ${server.id}`);

    // prune-stats is suite-independent and never gated.
    if (sub !== "prune-stats") needScript(server, sub);

    // Audit only what was allowed to run; "status" is read-only.
    if (sub !== "status") {
      const pruneMode =
        interaction.options.getBoolean("confirm") === true ? "confirmed" : "dry-run";
      await audit(
        interaction.user,
        interaction.guild?.id ?? null,
        sub,
        server,
        sub === "prune-stats" ? pruneMode : undefined,
      );
    }

    if (isDisruptiveServerAction(sub)) suppressAlerts(server.id);

    // Explicit, admin-gated stats cleanup. Dry run by default: it lists
    // what would be deleted; confirm:true deletes.
    if (sub === "prune-stats") {
      const whitelist = (await loadWhitelist(true, server)) ?? [];
      if (whitelist.length === 0) {
        throw new CommandError({ problem: t("control.pruneNoWhitelist") });
      }
      const known = new Set(whitelist.map((p) => p.uuid));
      const allStats = await loadAllStats(server);
      const orphans = Object.keys(allStats).filter((uuid) => !known.has(uuid));

      if (orphans.length === 0) {
        await interaction.editReply({
          embeds: [createSuccessEmbed(t("control.pruneNone", { server: server.id }))],
        });
        return;
      }

      if (interaction.options.getBoolean("confirm") !== true) {
        const list = `${orphans.slice(0, 20).join("\n")}${orphans.length > 20 ? "\n..." : ""}`;
        await interaction.editReply({
          embeds: [
            createEmbed({
              title: t("control.pruneDryTitle", { server: server.id }),
              description: t("control.pruneDryBody", { count: orphans.length, list }),
              color: EmbedColor.Pending,
            }),
          ],
        });
        return;
      }

      let deletedCount = 0;
      for (const uuid of orphans) {
        if (await deleteStats(uuid, server)) deletedCount++;
      }
      log.info(
        "control",
        `prune-stats: ${interaction.user.tag} deleted ${deletedCount}/${orphans.length} stats file(s) on ${server.id}`,
      );
      await interaction.editReply({
        embeds: [
          createSuccessEmbed(t("control.pruned", { count: deletedCount, server: server.id }), {
            title: t("control.prunedTitle"),
          }),
        ],
      });
      return;
    }

    if (sub === "status") {
      const result = await serverAccess.runScript(server.config, sub);
      const output = (result.output || t("control.noOutput")).slice(0, 3900);
      await interaction.editReply({
        embeds: [
          createEmbed({
            title: t("control.statusTitle", { server: server.id }),
            description: codeBlock(output),
          }),
        ],
      });
      return;
    }

    const args: string[] = [];
    if (sub === "backup" && interaction.options.getBoolean("archive")) {
      args.push("--archive");
    }
    await runScriptAction(
      server,
      sub as ScriptAction,
      args,
      interaction.user.username,
      (embed) => interaction.editReply({ embeds: [embed] }),
      (embed) => interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }),
    );
  }),
  { defer: false },
);
