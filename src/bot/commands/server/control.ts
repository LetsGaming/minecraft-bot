import {
  MessageFlags,
  SlashCommandBuilder,
  codeBlock,
  type SlashCommandStringOption,
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
import { assertMayTargetServerId, resolveServer } from "../../utils/guild/guildRouter.js";
import { withErrorHandling, requireServerAdmin } from "../middleware.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { CommandError, errMsg } from "@mcbot/core/utils/error.js";
import { suppressAlerts } from "../../logWatcher/watchers/monitors/downtimeMonitor.js";
import { log } from "@mcbot/core/utils/logger.js";
import { recordControlAction } from "@mcbot/core/utils/stores/serverControlRecord.js";
import * as serverAccess from "@mcbot/core/utils/server/serverAccess.js";
import { requireCapability } from "@mcbot/core/utils/server/capabilities.js";
import { loadAllStats, deleteStats } from "@mcbot/core/utils/minecraft/statUtils.js";
import { loadWhitelist } from "@mcbot/core/utils/minecraft/whitelist.js";
import { isDisruptiveServerAction } from "@mcbot/schema/serverActions.js";
import { t } from "@mcbot/core/utils/i18n.js";
import { auditAdminAction } from "../shared/audit.js";

const serverOption = (o: SlashCommandStringOption) =>
  o.setName("server").setDescription("Server instance").setAutocomplete(true);

export const data = new SlashCommandBuilder()
  .setName("server")
  .setDescription("Server control commands")
  .addSubcommand((sub) =>
    sub.setName("start").setDescription("Start the Minecraft server").addStringOption(serverOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("stop")
      .setDescription("Stop the server (30s countdown)")
      .addStringOption(serverOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("restart")
      .setDescription("Restart the server (30s countdown)")
      .addStringOption(serverOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("backup")
      .setDescription("Create a server backup")
      .addStringOption(serverOption)
      .addBooleanOption((o) =>
        o.setName("archive").setDescription("Create an archive backup instead of hourly"),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName("status")
      .setDescription("Get detailed server status via script")
      .addStringOption(serverOption),
  )
  .addSubcommand((sub) =>
    sub
      .setName("prune-stats")
      .setDescription("Delete stats files of players no longer on the whitelist")
      .addStringOption(serverOption),
  );

type ScriptAction = "start" | "stop" | "restart" | "backup";
type ConfirmedAction = "stop" | "restart";

const CONFIRM_ACTION: Record<ConfirmedAction, string> = {
  stop: "server-stop",
  restart: "server-restart",
};
const PRUNE_CONFIRM_ACTION = "server-prune-stats";

/** How long the confirmation waits for the player list before saying "unknown". */
const PLAYER_LOOKUP_BUDGET_MS = 1_500;
const OUTPUT_TAIL_CHARS = 1000;
const STATUS_OUTPUT_MAX = 3900;
const PRUNE_LIST_MAX = 20;

function needScript(server: ServerInstance, sub: string): void {
  requireCapability(
    server,
    (c) => c.scripts[sub as keyof typeof c.scripts] === true,
    t("capability.feature.script", { script: sub }),
  );
}

type Audited = Parameters<typeof auditAdminAction>[0];

function auditControl(
  interaction: Audited,
  sub: string,
  server: ServerInstance,
  detail?: string,
): Promise<void> {
  return auditAdminAction(interaction, {
    action: `server ${sub}`,
    server: server.id,
    ...(detail ? { detail } : {}),
  });
}

/** Resolves with null when `work` has not settled within `ms`; the timer never outlives the call. */
async function withinBudget<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
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
        problem: codeBlock(detail.slice(-OUTPUT_TAIL_CHARS)),
      }),
    );
    return;
  }

  const output =
    result.output && sub !== "start" ? `\n${codeBlock(result.output.slice(-OUTPUT_TAIL_CHARS))}` : "";
  await show(
    createSuccessEmbed(t(`control.done.${sub}`, { server: server.id }) + output, {
      title: t(`control.doneTitle.${sub}`, { server: server.id }),
    }),
  );
}

function confirmRow(interaction: ChatInputCommandInteraction, action: string, serverId: string, label: string) {
  const target = confirmTarget(action, serverId, interaction.user.id);
  return { target, row: createConfirmRow(target, label) };
}

/** Stop and restart disconnect everyone, so they ask first, ephemerally. */
async function askToConfirm(
  interaction: ChatInputCommandInteraction,
  sub: ConfirmedAction,
): Promise<void> {
  const server = resolveServer(interaction);
  needScript(server, sub);

  // The reply must go out within Discord's 3 s window and this command is not
  // deferred, so the roster gets a short budget and anything but an answer
  // reads as "unknown" rather than "nobody online".
  const list = await withinBudget(server.getList(), PLAYER_LOOKUP_BUDGET_MS);
  const players = list?.ok ? list.value.players : null;
  const description =
    players === null
      ? t(`control.confirmBodyUnknown.${sub}`)
      : players.length === 0
        ? t(`control.confirmBodyEmpty.${sub}`)
        : t(`control.confirmBody.${sub}`, { count: players.length });

  const { target, row } = confirmRow(
    interaction,
    CONFIRM_ACTION[sub],
    server.id,
    t(`control.confirmButton.${sub}`, { server: server.id }),
  );
  await interaction.reply({
    embeds: [
      createConfirmEmbed({
        title: t(`control.confirmTitle.${sub}`, { server: server.id }),
        description,
      }),
    ],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
  scheduleConfirmExpiry(interaction, target);
}

async function onConfirmed(
  interaction: ButtonInteraction,
  sub: ConfirmedAction,
  serverId: string,
): Promise<void> {
  const server = assertMayTargetServerId(interaction, serverId);
  needScript(server, sub);

  log.info("control", `${interaction.user.tag} → /server ${sub} on ${server.id} (confirmed)`);
  await auditControl(interaction, sub, server);
  try {
    recordControlAction(server.id, {
      kind: sub,
      by: interaction.user.username,
      byId: interaction.user.id,
      at: Date.now(),
    });
  } catch (err) {
    log.warn("control", `Could not record /server ${sub} on ${server.id}: ${errMsg(err)}`);
  }
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

/** Stats files whose owner is not on the whitelist. */
async function findOrphanedStats(server: ServerInstance): Promise<string[]> {
  const whitelist = (await loadWhitelist(true, server)) ?? [];
  if (whitelist.length === 0) {
    throw new CommandError({ problem: t("control.pruneNoWhitelist") });
  }
  const known = new Set(whitelist.map((p) => p.uuid));
  const allStats = await loadAllStats(server);
  return Object.keys(allStats).filter((uuid) => !known.has(uuid));
}

/** Lists what would be deleted and asks, like stop and restart do. */
async function askToPrune(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = resolveServer(interaction);
  log.info("control", `${interaction.user.tag} → /prune-stats on ${server.id}`);
  await auditControl(interaction, "prune-stats", server, "dry-run");

  const orphans = await findOrphanedStats(server);
  if (orphans.length === 0) {
    await interaction.editReply({
      embeds: [createSuccessEmbed(t("control.pruneNone", { server: server.id }))],
    });
    return;
  }

  const list = `${orphans.slice(0, PRUNE_LIST_MAX).join("\n")}${orphans.length > PRUNE_LIST_MAX ? "\n..." : ""}`;
  const { target, row } = confirmRow(
    interaction,
    PRUNE_CONFIRM_ACTION,
    server.id,
    t("control.confirmButton.prune", { server: server.id }),
  );
  await interaction.editReply({
    embeds: [
      createConfirmEmbed({
        title: t("control.pruneDryTitle", { server: server.id }),
        description: t("control.pruneDryBody", { count: orphans.length, list }),
      }),
    ],
    components: [row],
  });
  scheduleConfirmExpiry(interaction, target);
}

async function onPruneConfirmed(interaction: ButtonInteraction, serverId: string): Promise<void> {
  const server = assertMayTargetServerId(interaction, serverId);
  await interaction.update({
    embeds: [
      createEmbed({
        description: t("control.pruneRunning", { server: server.id }),
        color: EmbedColor.Pending,
      }),
    ],
    components: [],
  });
  await auditControl(interaction, "prune-stats", server, "confirmed");

  const orphans = await findOrphanedStats(server);
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
}

async function showStatus(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = resolveServer(interaction);
  needScript(server, "status");
  const result = await serverAccess.runScript(server.config, "status");
  const output = (result.output || t("control.noOutput")).slice(0, STATUS_OUTPUT_MAX);
  await interaction.editReply({
    embeds: [
      createEmbed({
        title: t("control.statusTitle", { server: server.id }),
        description: codeBlock(output),
      }),
    ],
  });
}

async function runScriptSubcommand(
  interaction: ChatInputCommandInteraction,
  sub: "start" | "backup",
): Promise<void> {
  const server = resolveServer(interaction);
  log.info("control", `${interaction.user.tag} → /${sub} on ${server.id}`);
  needScript(server, sub);
  await auditControl(interaction, sub, server);
  if (isDisruptiveServerAction(sub)) suppressAlerts(server.id);

  const args = sub === "backup" && interaction.options.getBoolean("archive") ? ["--archive"] : [];
  await runScriptAction(
    server,
    sub,
    args,
    interaction.user.username,
    (embed) => interaction.editReply({ embeds: [embed] }),
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
registerConfirmAction(
  PRUNE_CONFIRM_ACTION,
  (interaction, target) => onPruneConfirmed(interaction, target.serverId),
  { confirmLabelKey: "control.confirmButton.prune" },
);

export const execute = withErrorHandling(
  requireServerAdmin(async (interaction) => {
    const sub = interaction.options.getSubcommand();
    switch (sub) {
      case "stop":
      case "restart":
        await askToConfirm(interaction, sub);
        return;
      case "prune-stats":
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await askToPrune(interaction);
        return;
      case "status":
        await interaction.deferReply();
        await showStatus(interaction);
        return;
      case "start":
      case "backup":
        await interaction.deferReply();
        await runScriptSubcommand(interaction, sub);
        return;
    }
  }),
  { defer: false },
);
