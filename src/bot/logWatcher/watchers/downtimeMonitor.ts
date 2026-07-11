import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { serverInScope } from "../../utils/guildRouter.js";
import { recordCheck } from "@mcbot/core/utils/uptimeTracker.js";
import { createEmbed } from "../../utils/embedUtils.js";
import { EmbedColor } from "../../utils/embedColors.js";
import { roleMention } from "../../utils/alertUtils.js";
import { fireWatches } from "./watchFirer.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import {
  loadSessionStore,
  saveSessionStore,
  closeAllOpenSessions,
} from "@mcbot/core/utils/sessionStore.js";
import type { ServerInstance } from "@mcbot/core/utils/server.js";
import type { DowntimeState, GuildConfig } from "@mcbot/core/types/index.js";

const CHECK_INTERVAL_MS = 60 * 1000;
const FAILURES_BEFORE_ALERT = 3;

const serverStates = new Map<string, DowntimeState>();

function getState(serverId: string): DowntimeState {
  if (!serverStates.has(serverId)) {
    serverStates.set(serverId, {
      consecutiveFailures: 0,
      alerted: false,
      suppressUntil: 0,
      lastKnownState: null,
    });
  }
  return serverStates.get(serverId)!;
}

/**
 * Call this when an admin intentionally stops or restarts a server.
 * Suppresses downtime alerts for a grace period so the stop isn't flagged.
 */
export function suppressAlerts(
  serverId: string,
  graceMs = 5 * 60 * 1000,
): void {
  const state = getState(serverId);
  state.suppressUntil = Date.now() + graceMs;
  state.consecutiveFailures = 0;
  state.alerted = false;
  log.info(
    "downtime",
    `Alerts suppressed for ${serverId} (${graceMs / 1000}s grace)`,
  );
}

/**
 * Start the downtime monitor.
 *
 * Accepts either a fixed array (legacy/tests) or a provider
 * function that is consulted on every tick — pass getAllInstances so
 * servers added/removed by config-reload reconciliation are picked up
 * without restarting the monitor.
 */
export function startDowntimeMonitor(
  servers: ServerInstance[] | (() => ServerInstance[]),
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): ReturnType<typeof setInterval> {
  const getServers = typeof servers === "function" ? servers : () => servers;

  const guildsWithAlerts = Object.entries(guildConfigs).filter(
    ([, cfg]) => cfg.downtimeAlerts?.channelId,
  );

  if (guildsWithAlerts.length === 0) {
    log.info("downtime", "No downtime alert channels configured");
  }

  const timer = setInterval(async () => {
    for (const server of getServers()) {
      try {
        await checkServer(server, client, guildsWithAlerts);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("downtime", `Check error for ${server.id}: ${msg}`);
      }
    }
  }, CHECK_INTERVAL_MS);

  log.info(
    "downtime",
    `Monitor active for ${getServers().length} server(s), alerting ${guildsWithAlerts.length} guild(s)`,
  );
  return timer;
}

async function checkServer(
  server: ServerInstance,
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
): Promise<void> {
  const state = getState(server.id);
  const now = Date.now();

  let isOnline = false;
  try {
    isOnline = await server.isRunning();
  } catch {
    isOnline = false;
  }

  // Record for uptime tracking (independent of alert logic)
  await recordCheck(server.id, isOnline);

  if (isOnline) {
    const wasDown = state.alerted;
    state.consecutiveFailures = 0;

    if (wasDown) {
      state.alerted = false;
      state.lastKnownState = "online";

      // One-shot /watch subscribers get their recovery DM regardless of
      // any guild alert channel config.
      fireWatches(client, { kind: "server", serverId: server.id });

      for (const [guildId, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (!alertCfg?.channelId) continue;
        if (!serverInScope(alertCfg.server, server.id, guildId)) continue;

        await runWithGuildLocale(guildId, () =>
          sendAlert(client, alertCfg.channelId!, {
            title: t("downtime.upTitle"),
            description: t("downtime.up", { server: server.id }),
            color: EmbedColor.Success,
            serverId: server.id,
            mentionRole: alertCfg.mentionRole,
          }),
        );
      }

      log.info("downtime", `${server.id} recovered`);
    }

    state.lastKnownState = "online";
  } else {
    state.consecutiveFailures++;

    if (now < state.suppressUntil) {
      state.lastKnownState = "offline";
      return;
    }

    if (state.consecutiveFailures >= FAILURES_BEFORE_ALERT && !state.alerted) {
      state.alerted = true;
      state.lastKnownState = "offline";

      // A crash emits no per-player leave lines and no "Stopping server"
      // line, so the confirmed-down transition is where crashed sessions
      // get closed (clean stops are handled by the serverEvents watcher).
      // Waiting for the alert threshold keeps a single RCON blip from
      // wrongly ending everyone's sessions. Fire-and-forget: session
      // bookkeeping must never delay or break the alert itself.
      void (async () => {
        const sessions = await loadSessionStore();
        const closed = closeAllOpenSessions(sessions, server.id);
        if (closed > 0) {
          await saveSessionStore(sessions);
          log.info(
            "sessions",
            `Closed ${closed} open session(s) on ${server.id} (crash detected)`,
          );
        }
      })().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        log.warn(
          "sessions",
          `Failed to close sessions for ${server.id}: ${msg}`,
        );
      });

      for (const [guildId, gcfg] of guildsWithAlerts) {
        const alertCfg = gcfg.downtimeAlerts;
        if (!alertCfg?.channelId) continue;
        if (!serverInScope(alertCfg.server, server.id, guildId)) continue;

        await runWithGuildLocale(guildId, () =>
          sendAlert(client, alertCfg.channelId!, {
            title: t("downtime.downTitle"),
            description: t("downtime.down", {
              server: server.id,
              failures: state.consecutiveFailures,
            }),
            color: EmbedColor.Error,
            serverId: server.id,
            mentionRole: alertCfg.mentionRole,
          }),
        );
      }

      log.warn(
        "downtime",
        `${server.id} down (${state.consecutiveFailures} consecutive failures)`,
      );
    }
  }
}

interface AlertOptions {
  title: string;
  description: string;
  color: number;
  serverId: string;
  mentionRole?: string;
}

async function sendAlert(
  client: Client,
  channelId: string,
  { title, description, color, serverId, mentionRole }: AlertOptions,
): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !("send" in channel)) return;

    const embed = createEmbed({
      title,
      description,
      color,
      footer: { text: serverId },
    });

    await channel.send({ embeds: [embed], ...roleMention(mentionRole) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("downtime", `Failed to send alert: ${msg}`);
  }
}
