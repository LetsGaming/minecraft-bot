import { formatBytes } from "@mcbot/schema";
import { SlashCommandBuilder } from "discord.js";
import { createEmbed } from "../../utils/embeds/embedUtils.js";
import { resolveServer } from "../../utils/guild/guildRouter.js";
import { clockTimestamp } from "../../utils/discordTime.js";

import { withErrorHandling } from "../middleware.js";
import {
  describeHealth,
  describePlayers,
} from "../../utils/embeds/serverStateDisplay.js";
import { ServerState, canQueryServer } from "@mcbot/schema/serverState.js";
import {
  getHostResources,
} from "@mcbot/core/utils/server/hostResources.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { pingServer } from "@mcbot/core/utils/server/serverAccess.js";
import {
  formatVersionLabel,
  parseVersionName,
} from "@mcbot/core/utils/minecraft/versionName.js";
import { getUptimeStats } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { controlActionBehindDowntime } from "@mcbot/core/utils/stores/serverControlRecord.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import { resolveLanguage, t } from "@mcbot/core/utils/i18n.js";

/** TPS and the version ping are extras: a slow answer drops the field instead of delaying the reply. */
const EXTRA_BUDGET_MS = 2_000;

export const data = new SlashCommandBuilder()
  .setName("status")
  .setDescription("Get the current status of a Minecraft server")
  .addStringOption((o) =>
    o.setName("server").setDescription("Server instance").setAutocomplete(true),
  );

async function withinBudget<T>(work: Promise<T>): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), EXTRA_BUDGET_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readTps(server: ServerInstance): Promise<string | null> {
  if (!server.supportsTps) return null;
  const tps = await withinBudget(server.getTps());
  if (!tps) return null;
  return tps.tps1m.toLocaleString(resolveLanguage(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

async function readVersion(server: ServerInstance): Promise<string | null> {
  const ping = await withinBudget(pingServer(server.config));
  return formatVersionLabel(
    parseVersionName(ping?.kind === "status" ? ping.result.version : null),
  );
}

async function readOnlineFor(server: ServerInstance): Promise<string | null> {
  try {
    const stats = await getUptimeStats(server.id);
    return stats.currentState === "online" && stats.currentStateDuration > 0
      ? formatSpan(stats.currentStateDuration)
      : null;
  } catch {
    return null;
  }
}

/** Who took the server down and how to bring it back, when that is known. */
function offlineLine(server: ServerInstance): string {
  let record: ReturnType<typeof controlActionBehindDowntime> = null;
  try {
    record = controlActionBehindDowntime(server.id);
  } catch {
    /* the record is additive; fall back to the plain line */
  }
  const first = record
    ? t(record.kind === "stop" ? "status.stoppedBy" : "status.restartedBy", {
        user: record.by,
        time: clockTimestamp(record.at),
      })
    : t("status.notRunning");
  return server.capabilities?.scripts.start === true
    ? `${first} ${t("status.startHint")}`
    : first;
}

export const execute = withErrorHandling(async (interaction) => {
  const sent = Date.now();
  const server = resolveServer(interaction);
  const health = await server.getHealth();
  const display = describeHealth(health);
  const botPing = interaction.client.ws.ping;
  const roundTrip = Date.now() - sent;

  // Only a responsive server can be asked for a player list. The other three
  // states each need their own answer — "Offline", "up but not answering",
  // and "we could not reach the API wrapper" are different facts, and this
  // reply used to give all of them as "**Offline**".
  if (!canQueryServer(health)) {
    // A direct ping can still supply counts with the wrapper down, so show
    // them — "online, 4 players, controls unavailable" is the whole point.
    const players = describePlayers(health);
    const offline = health.state === ServerState.Offline ? offlineLine(server) : null;
    const description = [players, display.hint, offline].filter(Boolean).join("\n");
    const embed = createEmbed({
      title: t("status.title", { server: server.id, label: display.label }),
      state: health.state,
      color: display.color,
      timestamp: true,
      ...(description ? { description } : {}),
    });
    embed.addFields(
      { name: t("status.botPing"), value: `${botPing}ms`, inline: true },
      { name: t("status.roundTrip"), value: `${roundTrip}ms`, inline: true },
    );
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  const [{ playerCount, maxPlayers, players }, tps, onlineFor, version] = await Promise.all([
    server.getList(),
    readTps(server),
    readOnlineFor(server),
    readVersion(server),
  ]);
  const embed = createEmbed({
    title: t("status.title", { server: server.id, label: display.label }),
    state: health.state,
    color: display.color,
    timestamp: true,
    ...(display.hint ? { description: display.hint } : {}),
  });
  if (players.length > 0)
    embed.addFields({
      name: t("status.online"),
      value: players.join(", "),
      inline: false,
    });
  embed.addFields({
    name: t("status.players"),
    value: `${playerCount}/${maxPlayers}`,
    inline: true,
  });
  if (tps) embed.addFields({ name: t("status.tps"), value: tps, inline: true });
  if (onlineFor) {
    embed.addFields({ name: t("status.onlineFor"), value: onlineFor, inline: true });
  }
  if (version) embed.addFields({ name: t("status.version"), value: version, inline: true });
  embed.addFields(
    { name: t("status.botPing"), value: `${botPing}ms`, inline: true },
    { name: t("status.roundTrip"), value: `${roundTrip}ms`, inline: true },
  );

  // Host section: process RAM/CPU + disk usage for local instances.
  // Remote instances get these via the wrapper /info extension later;
  // any failure here must never break the status reply.
  try {
    const host = await getHostResources(server);
    if (host) {
      const lines: string[] = [];

      // Machine first, then the process inside it — the old embed showed
      // only the Java process under a heading that said "Host", which read
      // as the machine being at 90% when it was idle.
      if (host.machine) {
        lines.push(
          t("status.hostMachine", {
            ram: formatBytes(host.machine.memUsedBytes),
            ramTotal: formatBytes(host.machine.memTotalBytes),
            cpu: host.machine.cpuPercent.toFixed(0),
            cores: host.machine.cpuCount,
          }),
        );
      }
      if (host.process) {
        lines.push(
          t("status.hostProcess", {
            ram: formatBytes(host.process.rssBytes),
            cpu: host.process.cpuPercent.toFixed(0),
          }),
        );
      }

      // One line per filesystem, with the directories that sit on it
      // underneath. Printing df figures per directory made two dirs on one
      // disk look like two disks with a coincidentally identical free space.
      const byFilesystem = new Map<string, typeof host.disks>();
      for (const disk of host.disks) {
        const key = disk.filesystem.mountPoint || disk.path;
        byFilesystem.set(key, [...(byFilesystem.get(key) ?? []), disk]);
      }
      for (const [mount, disks] of byFilesystem) {
        const fs = disks[0]!.filesystem;
        lines.push(
          t("status.hostFilesystem", {
            mount,
            percent: fs.usedPercent,
            free: formatBytes(fs.availableBytes),
            total: formatBytes(fs.totalBytes),
          }),
        );
        for (const disk of disks) {
          lines.push(
            disk.sizeBytes === null
              ? t("status.hostDirUnknown", { path: disk.path })
              : t("status.hostDir", {
                  path: disk.path,
                  size: formatBytes(disk.sizeBytes),
                }),
          );
        }
      }
      if (lines.length > 0) {
        embed.addFields({
          name: t("status.hostTitle"),
          value: lines.join("\n"),
          inline: false,
        });
      }
    }
  } catch {
    /* host metrics are additive — never fail the status */
  }

  await interaction.editReply({ embeds: [embed] });
});
