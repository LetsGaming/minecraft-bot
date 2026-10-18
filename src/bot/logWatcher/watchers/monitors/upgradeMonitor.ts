/**
 * Posts one live message per server upgrade to the downtime alert channel and
 * keeps it up to date, whoever started the upgrade (the dashboard or an SSH
 * session): the wrapper's job, or the script's status file after a wrapper
 * restart, is the single source.
 *
 * It also keeps downtime alerts quiet while the job runs, so the planned stop
 * and the restart are not reported as an outage.
 */
import type { Client, EmbedBuilder, Message } from "discord.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import {
  getCurrentUpgrade,
  supportsUpgrade,
} from "@mcbot/core/utils/server/serverAccess.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type { UpgradeJob } from "@mcbot/schema/wire/index.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { serverInScope } from "../../../utils/guild/guildRouter.js";
import { guildsWith, type GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor, embedColorFor } from "../../../utils/embeds/embedColors.js";
import { progressBar } from "../../../utils/embeds/gameDisplay.js";
import { formatBytes } from "@mcbot/schema/format.js";
import {
  phaseRows,
  isJobPhase,
  isJobFailureReason,
  UPGRADE_PHASES,
  PRUNE_PHASES,
} from "@mcbot/schema/upgradePhases.js";
import { holdAlerts } from "./downtimeMonitor.js";

const POLL_INTERVAL_MS = 15_000;
const SUPPORT_CACHE_MS = 5 * 60_000;
/** Downtime alerts stay quiet this long past the latest sign of life from the job. */
const ALERT_HOLD_MS = 10 * 60_000;
/** A job that finished longer ago than this is history, not news. */
const FRESH_RESULT_SECONDS = 10 * 60;

export { UPGRADE_PHASES, PRUNE_PHASES };

/** The latest status of each top-level phase, in the order they first appeared. */
export const phaseViews = phaseRows;

function statusIcon(status: string): string {
  if (status === "done") return "✅";
  if (status === "error") return "❌";
  return "⏳";
}

function phaseName(phase: string): string {
  return isJobPhase(phase) ? t(`upgrade.phase.${phase}`) : phase;
}

function resultLines(job: UpgradeJob): string[] {
  const r = job.result;
  if (!r) return [t("upgrade.interrupted")];
  const lines: string[] = [];
  if (r.ok) {
    const disabled = r.disabled ?? [];
    lines.push(
      disabled.length > 0
        ? t("upgrade.resultDisabled", { mods: disabled.join(", ") })
        : t("upgrade.resultClean"),
    );
    const kept = r.keptOnOldBuild ?? [];
    if (kept.length > 0) lines.push(t("upgrade.keptOld", { mods: kept.join(", ") }));
  } else if (r.rolledBack) {
    lines.push(
      r.previousVersionRunning === false ? t("upgrade.rolledBackDown") : t("upgrade.rolledBack"),
    );
  } else if (r.reason === "rollback_failed") {
    lines.push(t("upgrade.rollbackFailed"));
  } else {
    const reason = isJobFailureReason(r.reason) ? t(`upgrade.reason.${r.reason}`) : t("upgrade.reason.other");
    lines.push(t("upgrade.failedBefore", { reason }));
  }
  if (typeof r.prunedChunks === "number") {
    lines.push(
      t("upgrade.pruned", { chunks: r.prunedChunks, size: formatBytes(r.bytesFreed ?? 0) }),
    );
  }
  if (typeof r.archive === "string") lines.push(t("upgrade.archive", { file: r.archive }));
  return lines;
}

/** The embed for one job as it stands. Built inside the guild's locale context. */
export function renderUpgrade(serverId: string, job: UpgradeJob): EmbedBuilder {
  const version = job.mcVersion || job.result?.target || "?";
  const views = phaseViews(job.events);
  const prune = job.kind === "prune";
  const steps = prune ? PRUNE_PHASES : UPGRADE_PHASES;
  const doneCount = steps.filter((p) =>
    views.some((v) => v.phase === p && v.status === "done"),
  ).length;

  const lines = views.map(
    (v) =>
      `${statusIcon(v.status)} ${phaseName(v.phase)}${v.status === "running" && v.msg ? `: ${v.msg}` : ""}`,
  );

  const finished = job.state !== "running";
  const ok = job.result?.ok === true;
  const clean = ok && (job.result?.disabled ?? []).length === 0;

  const base = prune ? "prune" : "upgrade";
  let titleKey = `${base}.title`;
  let color: number = embedColorFor(EmbedCategory.Server);
  if (finished) {
    if (ok) {
      titleKey = `${base}.titleDone`;
      color = clean ? embedColorFor(EmbedCategory.Recovery) : EmbedColor.Warning;
    } else {
      titleKey = job.result?.rolledBack ? `${base}.titleRolledBack` : `${base}.titleFailed`;
      color = EmbedColor.Error;
    }
  }

  const body = [
    ...lines,
    ...(finished ? ["", ...resultLines(job)] : []),
    ...(finished ? [] : ["", `${progressBar(doneCount, steps.length, 10)} ${doneCount}/${steps.length}`]),
  ].join("\n");

  return createEmbed({
    title: t(titleKey, { server: serverId, version }),
    description: body,
    category: EmbedCategory.Server,
    color,
    timestamp: true,
  });
}

interface Tracked {
  jobId: string;
  /** Last rendered state, to skip edits that would change nothing. */
  key: string;
  messages: Map<string, Message>;
  finished: boolean;
}

export interface UpgradeMonitorDeps {
  getCurrentUpgrade: typeof getCurrentUpgrade;
  supportsUpgrade: typeof supportsUpgrade;
  holdAlerts: typeof holdAlerts;
  now: () => number;
}

const realDeps: UpgradeMonitorDeps = {
  getCurrentUpgrade,
  supportsUpgrade,
  holdAlerts,
  now: () => Date.now(),
};

export function createUpgradeMonitor(
  client: Client,
  guildConfigs: GuildConfigSource,
  deps: UpgradeMonitorDeps = realDeps,
) {
  const tracked = new Map<string, Tracked>();
  const supportCache = new Map<string, { value: boolean; at: number }>();

  async function supported(server: ServerInstance): Promise<boolean> {
    const hit = supportCache.get(server.id);
    if (hit && deps.now() - hit.at < SUPPORT_CACHE_MS) return hit.value;
    let value = false;
    try {
      value = await deps.supportsUpgrade(server.config);
    } catch {
      value = false;
    }
    supportCache.set(server.id, { value, at: deps.now() });
    return value;
  }

  async function publish(serverId: string, job: UpgradeJob, track: Tracked): Promise<void> {
    const channels = guildsWith(guildConfigs, (cfg) => !!cfg.downtimeAlerts?.channelId);
    for (const [guildId, gcfg] of channels) {
      const alert = gcfg.downtimeAlerts;
      if (!alert?.channelId || !serverInScope(alert.server, serverId, guildId)) continue;
      await runWithGuildLocale(guildId, async () => {
        const embed = renderUpgrade(serverId, job);
        try {
          const existing = track.messages.get(guildId);
          if (existing) {
            await existing.edit({ embeds: [embed] });
            return;
          }
          const channel = await client.channels.fetch(alert.channelId!);
          if (!channel || !("send" in channel)) return;
          track.messages.set(guildId, await channel.send({ embeds: [embed] }));
        } catch (err) {
          log.warn("upgrade", `Could not post the upgrade for ${serverId}: ${errMsg(err)}`);
        }
      });
    }
  }

  async function checkServer(server: ServerInstance): Promise<void> {
    if (!server.config.apiUrl || !(await supported(server))) return;

    let job: UpgradeJob | null;
    try {
      job = await deps.getCurrentUpgrade(server.config, 0);
    } catch {
      return; // unreachable wrapper: the downtime monitor says so
    }
    if (!job) {
      tracked.delete(server.id);
      return;
    }

    if (job.state === "running") deps.holdAlerts(server.id, ALERT_HOLD_MS);

    const known = tracked.get(server.id);
    const lastSeq = job.events.length > 0 ? job.events[job.events.length - 1]!.seq : 0;
    const key = `${job.jobId}:${job.state}:${lastSeq}:${job.result ? "r" : ""}`;

    if (known && known.jobId === job.jobId) {
      if (known.key === key) return;
      known.key = key;
      known.finished = job.state !== "running";
      await publish(server.id, job, known);
      return;
    }

    // A job nobody here has seen. A running one is news; a finished one only
    // if it ended moments ago (the bot restarted mid-upgrade), not history.
    const lastTs = job.events.length > 0 ? job.events[job.events.length - 1]!.ts : 0;
    const fresh = deps.now() / 1000 - lastTs < FRESH_RESULT_SECONDS;
    const alreadyDone = job.state !== "running" && !fresh;
    const track: Tracked = {
      jobId: job.jobId,
      key,
      messages: new Map(),
      finished: job.state !== "running",
    };
    tracked.set(server.id, track);
    if (!alreadyDone) await publish(server.id, job, track);
  }

  async function tick(servers: readonly ServerInstance[]): Promise<void> {
    for (const server of servers) {
      try {
        await checkServer(server);
      } catch (err) {
        log.error("upgrade", `Check error for ${server.id}: ${errMsg(err)}`);
      }
    }
  }

  return { tick };
}

export function startUpgradeMonitor(
  servers: () => ServerInstance[],
  client: Client,
  guildConfigs: GuildConfigSource,
): ReturnType<typeof setInterval> {
  const monitor = createUpgradeMonitor(client, guildConfigs);
  const timer = setInterval(() => void monitor.tick(servers()), POLL_INTERVAL_MS);
  timer.unref();
  return timer;
}
