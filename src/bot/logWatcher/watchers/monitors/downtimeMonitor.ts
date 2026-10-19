import { type APIEmbedField, type Client } from "discord.js";
import { formatLastSeen } from "../../../utils/discordTime.js";
import { log } from "@mcbot/core/utils/logger.js";
import {
  guildsWith,
  type GuildConfigSource,
} from "../../../utils/guild/guildConfigs.js";
import { recordCheck } from "@mcbot/core/utils/stores/uptimeTracker.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import { alertMention, type AlertLevel } from "../../../utils/embeds/alertUtils.js";
import { fireWatches } from "../watchFirer.js";
import { t } from "@mcbot/core/utils/i18n.js";
import {
  updateSessionStore,
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
import type { DowntimeState } from "@mcbot/core/types/index.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { parsePlayerCounts } from "@mcbot/core/utils/minecraft/playerCounts.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import { MS } from "@mcbot/schema";
import { onServerRemoved } from "../../serverCleanup.js";
import { sendToGuildChannels } from "../notifyGuilds.js";
import { startPoller, type Poller } from "../poller.js";

const CHECK_INTERVAL_MS = MS.minute;
const FAILURES_BEFORE_ALERT = 3;
/**
 * The wrapper gets a longer fuse than the server. Restarting it, redeploying
 * it, or a brief network hiccup is routine and self-healing, and it says
 * nothing about the Minecraft server, which is usually still up with players
 * on it. Five minutes of silence is worth mentioning; one is noise.
 */
const UNREACHABLE_BEFORE_ALERT = 5;

const serverStates = new Map<string, DowntimeState>();

onServerRemoved((serverId) => {
  serverStates.delete(serverId);
});

function getState(serverId: string): DowntimeState {
  if (!serverStates.has(serverId)) {
    serverStates.set(serverId, {
      consecutiveFailures: 0,
      alerted: false,
      consecutiveUnreachable: 0,
      wrapperAlerted: false,
      crashLoopAlerted: false,
      suppressUntil: 0,
      lastKnownState: null,
    });
  }
  return serverStates.get(serverId)!;
}

/** Forget a half-counted outage: counters back to zero, no alert outstanding. */
function resetOutage(state: DowntimeState): void {
  state.consecutiveFailures = 0;
  state.alerted = false;
  state.downSince = undefined;
  state.consecutiveUnreachable = 0;
  state.wrapperAlerted = false;
  state.crashLoopAlerted = false;
}

/**
 * Keeps alerts quiet for a server while a long planned operation runs (a
 * version upgrade), extending the window on every call without resetting what
 * the monitor already counted. Unlike suppressAlerts it never lowers an
 * existing window and does not log each time, since it is called every poll.
 */
export function holdAlerts(serverId: string, graceMs: number): void {
  const state = getState(serverId);
  const until = Date.now() + graceMs;
  if (until <= state.suppressUntil) return;
  if (state.suppressUntil <= Date.now()) {
    // First hold of this operation: forget any half-counted outage.
    resetOutage(state);
  }
  state.suppressUntil = until;
}

/**
 * Call this when an admin intentionally stops or restarts a server.
 * Suppresses downtime alerts for a grace period so the stop isn't flagged.
 */
export function suppressAlerts(
  serverId: string,
  graceMs = 5 * MS.minute,
): void {
  const state = getState(serverId);
  state.suppressUntil = Date.now() + graceMs;
  resetOutage(state);
  state.stopRequestedAt = Date.now();
  log.info(
    "downtime",
    `Alerts suppressed for ${serverId} (${graceMs / MS.second}s grace)`,
  );
}

/** A "Stopping server" log line: the next downtime is not a crash. */
export function noteServerStopping(serverId: string): void {
  getState(serverId).stopRequestedAt = Date.now();
}

/** Players online right now, for the alert if the server goes down next. */
async function countPlayers(server: ServerInstance, health: ServerHealth): Promise<number | undefined> {
  if (health.players) return health.players.online;
  const list = await server.getList();
  return list.ok ? (parsePlayerCounts(list.value).online ?? undefined) : undefined;
}

/**
 * Start the downtime monitor.
 *
 * Accepts either a fixed array (legacy/tests) or a provider
 * function that is consulted on every tick, pass getAllInstances so
 * servers added/removed by config-reload reconciliation are picked up
 * without restarting the monitor.
 */
export function startDowntimeMonitor(
  servers: ServerInstance[] | (() => ServerInstance[]),
  client: Client,
  guildConfigs: GuildConfigSource,
): Poller {
  const getServers = typeof servers === "function" ? servers : () => servers;
  const ctx: AlertContext = { client, guildConfigs };

  // Resolved per tick, not once: a guild whose downtimeAlerts block is
  // added on config reload has to start receiving alerts without a restart.
  const alertGuildCount = (): number =>
    guildsWith(guildConfigs, (cfg) => !!cfg.downtimeAlerts?.channelId).length;

  if (alertGuildCount() === 0) {
    log.info("downtime", "No downtime alert channels configured");
  }

  const poller = startPoller(
    "downtime",
    async () => {
      for (const server of getServers()) {
        try {
          await checkServer(server, ctx);
        } catch (err) {
          log.error("downtime", `Check error for ${server.id}: ${errMsg(err)}`);
        }
      }
    },
    CHECK_INTERVAL_MS,
  );

  log.info(
    "downtime",
    `Monitor active for ${getServers().length} server(s), alerting ${alertGuildCount()} guild(s)`,
  );
  return poller;
}

async function checkServer(server: ServerInstance, ctx: AlertContext): Promise<void> {
  const state = getState(server.id);
  const now = Date.now();

  let health: ServerHealth;
  try {
    health = await server.getHealth();
  } catch (err) {
    // getHealth() encodes its failures in the value, so reaching this is a bug
    // in the call path rather than an outage, but it is still not evidence
    // about the server, so it degrades to the same "we don't know".
    health = unknownHealth(errMsg(err), now);
  }

  // Below FAILURES_BEFORE_ALERT/UNREACHABLE_BEFORE_ALERT a state flip never
  // reaches an alert or a warn log, so a blip that self-heals in one or two
  // ticks otherwise leaves no trace at all. Set DEBUG=1 to see every poll.
  log.debug(
    "downtime",
    `${server.id}: state=${health.state} source=${health.source} ` +
      `wrapper=${health.wrapper} rcon=${health.rcon} players=${
        health.players?.online ?? "?"
      } reason=${health.reason ?? "-"}`,
  );

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
      const failures = state.consecutiveUnreachable;
      await alertGuilds(ctx, server.id, ["ok", "warning"], () => {
        const serverNote = stateIsKnown(health)
          ? t("downtime.apiDownServerKnown", {
              state: t(`state.${health.state}`),
            })
          : t("downtime.apiDownServerUnknown");
        return {
          title: t("downtime.apiDownTitle", { server: server.id }),
          description: `${t("downtime.apiDown", {
            server: server.id,
            failures,
          })}\n${serverNote}`,
          color: EmbedColor.Warning,
        };
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
    await alertGuilds(ctx, server.id, ["warning", "ok"], () => ({
      title: t("downtime.apiUpTitle", { server: server.id }),
      description: t("downtime.apiUp", { server: server.id }),
      color: EmbedColor.Success,
    }));
    log.info("downtime", `${server.id}: API wrapper reachable again`);
  } else {
    state.consecutiveUnreachable = 0;
  }

  // ── Crash loop ───────────────────────────────────────────────────────────
  // Checked unconditionally, not gated by consecutiveFailures below: systemd's
  // StartLimitBurst (see create_service.sh) is unambiguous the moment it
  // trips, and waiting for FAILURES_BEFORE_ALERT consecutive offline polls is
  // exactly the threshold a loop can dodge by being briefly up whenever a
  // 60s tick happens to land.
  if (health.unitFailed) {
    if (!state.crashLoopAlerted && now >= state.suppressUntil) {
      state.crashLoopAlerted = true;
      const before: AlertLevel = state.alerted ? "error" : "ok";
      await alertGuilds(ctx, server.id, [before, "critical"], () => ({
        title: t("downtime.crashLoopTitle", { server: server.id }),
        description: t("downtime.crashLoop", {
          server: server.id,
          restarts: health.restartCount,
        }),
        state: ServerState.Offline,
      }));
      log.warn(
        "downtime",
        `${server.id}: crash loop detected — systemd restarted it ` +
          `${health.restartCount}× and gave up`,
      );
    }
  } else if (state.crashLoopAlerted) {
    state.crashLoopAlerted = false;
    await alertGuilds(ctx, server.id, ["critical", "ok"], () => ({
      title: t("downtime.crashLoopRecoveredTitle", { server: server.id }),
      description: t("downtime.crashLoopRecovered", { server: server.id }),
      color: EmbedColor.Success,
    }));
    log.info("downtime", `${server.id}: crash loop cleared`);
  }

  // ── The server ──────────────────────────────────────────────────────────
  // Nothing established what the server is doing, neither the wrapper nor a
  // direct ping. That takes both channels failing at once, and it is the one
  // case where the bot genuinely cannot say. Record nothing: uptime is a
  // measurement, and a missing sample is honest where a fabricated `false` is
  // not.
  if (!stateIsKnown(health)) return;

  // `unresponsive` counts as up: the process is running, it is just not
  // answering RCON, a lag spike, or a server still loading its world. TPS
  // alerting is the right tool for that, not a downtime page.
  const isOnline = health.state !== ServerState.Offline;

  // Record for uptime tracking (independent of alert logic). A failed write
  // must not skip the alert branch below.
  try {
    await recordCheck(server.id, isOnline);
  } catch (err) {
    log.warn("downtime", `Could not record the check for ${server.id}: ${errMsg(err)}`);
  }

  if (isOnline) {
    const wasDown = state.alerted;
    const downFor = state.downSince === undefined ? null : now - state.downSince;
    state.consecutiveFailures = 0;
    state.downSince = undefined;
    state.lastUpAt = now;
    if (health.state === ServerState.Online) {
      state.lastKnownPlayers = (await countPlayers(server, health)) ?? state.lastKnownPlayers;
    }

    if (wasDown) {
      state.alerted = false;

      // One-shot /watch subscribers get their recovery DM regardless of
      // any guild alert channel config.
      fireWatches(ctx.client, { kind: "server", serverId: server.id });

      await alertGuilds(ctx, server.id, ["error", "ok"], () => ({
        title: t("downtime.upTitle", { server: server.id }),
        description:
          downFor === null
            ? t("downtime.up", { server: server.id })
            : t("downtime.upAfter", { server: server.id, duration: formatSpan(downFor) }),
        state: ServerState.Online,
      }));

      log.info("downtime", `${server.id} recovered`);
    }

    state.lastKnownState = health.state;
  } else {
    state.consecutiveFailures++;
    state.downSince ??= now;

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
      try {
        const closed = updateSessionStore((sessions) =>
          closeAllOpenSessions(sessions, server.id),
        );
        if (closed > 0) {
          log.info(
            "sessions",
            `Closed ${closed} open session(s) on ${server.id} (crash detected)`,
          );
        }
      } catch (err) {
        log.warn(
          "sessions",
          `Failed to close sessions for ${server.id}: ${errMsg(err)}`,
        );
      }

      const before: AlertLevel = state.crashLoopAlerted ? "critical" : "ok";
      const { lastUpAt, lastKnownPlayers, stopRequestedAt } = state;
      // A stop request can land shortly before the last check that still
      // saw the server up, while it was shutting down.
      const crashed =
        lastUpAt !== undefined &&
        (stopRequestedAt === undefined || stopRequestedAt < lastUpAt - CHECK_INTERVAL_MS);
      await alertGuilds(ctx, server.id, [before, "error"], () => {
        const fields: APIEmbedField[] = [];
        if (lastUpAt !== undefined) {
          fields.push({ name: t("downtime.lastSeen"), value: formatLastSeen(lastUpAt), inline: true });
        }
        if (lastKnownPlayers !== undefined) {
          fields.push({ name: t("downtime.playersHit"), value: String(lastKnownPlayers), inline: true });
        }
        const down = t("downtime.down", { server: server.id, failures: state.consecutiveFailures });
        return {
          title: t("downtime.downTitle", { server: server.id }),
          description: crashed ? `${down}\n${t("downtime.crashHint")}` : down,
          state: ServerState.Offline,
          fields,
        };
      });

      log.warn(
        "downtime",
        `${server.id} down (${state.consecutiveFailures} consecutive failures)`,
      );
    }
  }
}

interface Alert {
  title: string;
  description: string;
  /** Server state for the title circle and colour; otherwise `color`. */
  state?: ServerState;
  color?: number;
  fields?: APIEmbedField[];
}

interface AlertContext {
  client: Client;
  guildConfigs: GuildConfigSource;
}

/**
 * Fan one alert out to every guild that subscribed to this server. The text
 * is built inside each guild's locale context, and whether the role is
 * pinged follows the guild's mention policy for the change `levels`
 * describes (previous, next).
 */
function alertGuilds(
  { client, guildConfigs }: AlertContext,
  serverId: string,
  levels: [AlertLevel, AlertLevel],
  buildAlert: () => Alert,
): Promise<void> {
  return sendToGuildChannels(client, guildConfigs, {
    pick: (gcfg) => gcfg.downtimeAlerts,
    serverId,
    logTag: "downtime",
    describe: "Failed to send alert",
    build: () => {
      const { title, description, state, color, fields } = buildAlert();
      const embed = createEmbed({
        title,
        description,
        state,
        color: color ?? (state ? undefined : EmbedColor.Info),
        timestamp: true,
      });
      if (fields && fields.length > 0) embed.addFields(fields);
      return { embeds: [embed] };
    },
    mention: (target) => alertMention(target.mentionRole, target.mentionPolicy, ...levels),
  });
}
