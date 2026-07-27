import { type Client } from "discord.js";
import { log } from "@mcbot/core/utils/logger.js";
import { serverInScope } from "../../../utils/guild/guildRouter.js";
import {
  guildsWith,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { recordCheck } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { roleMention } from "../../../utils/embeds/alertUtils.js";
import { fireWatches } from "../watchFirer.js";
import { t, runWithGuildLocale } from "@mcbot/core/utils/i18n.js";
import {
  loadSessionStore,
  saveSessionStore,
  closeAllOpenSessions,
} from "@mcbot/core/utils/stores/sessionStore.js";
import {
  ServerState,
  stateIsKnown,
  unknownHealth,
  wrapperIsDown,
} from "@mcbot/schema/serverState.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import type { ServerHealth } from "@mcbot/schema/serverState.js";
import type { DowntimeState, GuildConfig } from "@mcbot/core/types/index.js";

const CHECK_INTERVAL_MS = 60 * 1000;
const FAILURES_BEFORE_ALERT = 3;
/**
 * The wrapper gets a longer fuse than the server. Restarting it, redeploying
 * it, or a brief network hiccup is routine and self-healing, and it says
 * nothing about the Minecraft server — which is usually still up with players
 * on it. Five minutes of silence is worth mentioning; one is noise.
 */
const UNREACHABLE_BEFORE_ALERT = 5;

const serverStates = new Map<string, DowntimeState>();

function getState(serverId: string): DowntimeState {
  if (!serverStates.has(serverId)) {
    serverStates.set(serverId, {
      consecutiveFailures: 0,
      alerted: false,
      consecutiveUnreachable: 0,
      wrapperAlerted: false,
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
  state.consecutiveUnreachable = 0;
  state.wrapperAlerted = false;
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
  guildConfigs: GuildConfigSource,
): ReturnType<typeof setInterval> {
  const getServers = typeof servers === "function" ? servers : () => servers;

  // Resolved per tick, not once: a guild whose downtimeAlerts block is
  // added on config reload has to start receiving alerts without a restart.
  const alertGuilds = (): Array<[string, GuildConfig]> =>
    guildsWith(guildConfigs, (cfg) => !!cfg.downtimeAlerts?.channelId);

  if (alertGuilds().length === 0) {
    log.info("downtime", "No downtime alert channels configured");
  }

  const timer = setInterval(async () => {
    const guildsWithAlerts = alertGuilds();
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
    `Monitor active for ${getServers().length} server(s), alerting ${alertGuilds().length} guild(s)`,
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

  let health: ServerHealth;
  try {
    health = await server.getHealth();
  } catch (err) {
    // getHealth() encodes its failures in the value, so reaching this is a bug
    // in the call path rather than an outage — but it is still not evidence
    // about the server, so it degrades to the same "we don't know".
    health = unknownHealth(err instanceof Error ? err.message : String(err), now);
  }

  // ── The API wrapper ─────────────────────────────────────────────────────
  // Tracked on its own axis, because it fails independently of the server and
  // needs a different fix. Note this runs even when the server's own state is
  // perfectly well known via a direct ping: "everyone can play, but the bot
  // has lost its controls" is a real situation and deserves to be said out
  // loud rather than inferred from silence.
  if (wrapperIsDown(health)) {
    state.consecutiveUnreachable++;
    if (
      state.consecutiveUnreachable >= UNREACHABLE_BEFORE_ALERT &&
      !state.wrapperAlerted &&
      now >= state.suppressUntil
    ) {
      state.wrapperAlerted = true;
      // Say what the server is doing in the same breath. An operator woken by
      // this needs to know whether players are affected before anything else.
      const serverNote = stateIsKnown(health)
        ? t("downtime.apiDownServerKnown", {
            state: t(`state.${health.state}`),
          })
        : t("downtime.apiDownServerUnknown");
      await alertGuilds(client, guildsWithAlerts, server.id, {
        title: t("downtime.apiDownTitle"),
        description: `${t("downtime.apiDown", {
          server: server.id,
          failures: state.consecutiveUnreachable,
        })}\n${serverNote}`,
        color: EmbedColor.Warning,
      });
      log.warn(
        "downtime",
        `${server.id}: API wrapper unreachable ${state.consecutiveUnreachable}× ` +
          `(${health.reason ?? "no reason given"}); the server itself is ` +
          `${health.state} (via ${health.source})`,
      );
    }
  } else if (state.wrapperAlerted) {
    state.wrapperAlerted = false;
    state.consecutiveUnreachable = 0;
    await alertGuilds(client, guildsWithAlerts, server.id, {
      title: t("downtime.apiUpTitle"),
      description: t("downtime.apiUp", { server: server.id }),
      color: EmbedColor.Success,
    });
    log.info("downtime", `${server.id}: API wrapper reachable again`);
  } else {
    state.consecutiveUnreachable = 0;
  }

  // ── The server ──────────────────────────────────────────────────────────
  // Nothing established what the server is doing — neither the wrapper nor a
  // direct ping. That takes both channels failing at once, and it is the one
  // case where the bot genuinely cannot say. Record nothing: uptime is a
  // measurement, and a missing sample is honest where a fabricated `false` is
  // not.
  if (!stateIsKnown(health)) return;

  // `unresponsive` counts as up: the process is running, it is just not
  // answering RCON — a lag spike, or a server still loading its world. TPS
  // alerting is the right tool for that, not a downtime page.
  const isOnline = health.state !== ServerState.Offline;

  // Record for uptime tracking (independent of alert logic)
  await recordCheck(server.id, isOnline);

  if (isOnline) {
    const wasDown = state.alerted;
    state.consecutiveFailures = 0;

    if (wasDown) {
      state.alerted = false;

      // One-shot /watch subscribers get their recovery DM regardless of
      // any guild alert channel config.
      fireWatches(client, { kind: "server", serverId: server.id });

      await alertGuilds(client, guildsWithAlerts, server.id, {
        title: t("downtime.upTitle"),
        description: t("downtime.up", { server: server.id }),
        color: EmbedColor.Success,
      });

      log.info("downtime", `${server.id} recovered`);
    }

    state.lastKnownState = health.state;
  } else {
    state.consecutiveFailures++;

    if (now < state.suppressUntil) {
      state.lastKnownState = ServerState.Offline;
      return;
    }

    if (state.consecutiveFailures >= FAILURES_BEFORE_ALERT && !state.alerted) {
      state.alerted = true;
      state.lastKnownState = ServerState.Offline;

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

      await alertGuilds(client, guildsWithAlerts, server.id, {
        title: t("downtime.downTitle"),
        description: t("downtime.down", {
          server: server.id,
          failures: state.consecutiveFailures,
        }),
        color: EmbedColor.Error,
      });

      log.warn(
        "downtime",
        `${server.id} down (${state.consecutiveFailures} consecutive failures)`,
      );
    }
  }
}

/**
 * Fan one alert out to every guild that subscribed to this server.
 *
 * Extracted because there are now four of these (server down/up, wrapper
 * down/up) and the scope check, the locale wrapper, and the per-guild mention
 * role have to be identical in all of them — the kind of block that drifts the
 * moment it is written twice.
 */
async function alertGuilds(
  client: Client,
  guildsWithAlerts: Array<[string, GuildConfig]>,
  serverId: string,
  alert: { title: string; description: string; color: number },
): Promise<void> {
  for (const [guildId, gcfg] of guildsWithAlerts) {
    const alertCfg = gcfg.downtimeAlerts;
    if (!alertCfg?.channelId) continue;
    if (!serverInScope(alertCfg.server, serverId, guildId)) continue;

    await runWithGuildLocale(guildId, () =>
      sendAlert(client, alertCfg.channelId!, {
        ...alert,
        serverId,
        mentionRole: alertCfg.mentionRole,
      }),
    );
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
