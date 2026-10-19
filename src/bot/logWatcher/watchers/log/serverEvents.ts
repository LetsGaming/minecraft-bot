import { type Client } from "discord.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import type { ILogWatcher } from "../../logWatcher.js";
import type { NotificationEvent } from "@mcbot/schema";
import { broadcastNotification } from "../notifyGuilds.js";
import type { GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  updateSessionStore,
  closeAllOpenSessions,
} from "@mcbot/core/utils/stores/sessionStore.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
import { ServerState } from "@mcbot/schema/serverState.js";
import { formatSpan } from "@mcbot/core/utils/duration.js";
import { noteServerStopping } from "../monitors/downtimeMonitor.js";
import { onServerRemoved } from "../../serverCleanup.js";
// Anchored on the server thread tag: a chat message must not forge
// start/stop (a forged stop closes every open play session).
const START_REGEX = serverEventRegex(String.raw`Done \([\d.]+s\)!`);
const STOP_REGEX = serverEventRegex(String.raw`Stopping server`);

const startTimes = new Map<string, Date>();

onServerRemoved((serverId) => {
  startTimes.delete(serverId);
});

/**
 * A stopping server disconnects everyone without emitting per-player
 * leave lines, so every open session must be closed here, otherwise a
 * shutdown produces sessions that never end. Crashes (no "Stopping
 * server" line at all) are covered by the downtime monitor's offline
 * transition doing the same.
 */
function closeSessions(serverId: string): void {
  try {
    const closed = updateSessionStore((store) =>
      closeAllOpenSessions(store, serverId),
    );
    if (closed > 0) {
      log.info(
        "sessions",
        `Closed ${closed} open session(s) on ${serverId} (server stop)`,
      );
    }
  } catch (err) {
    log.warn("sessions", `Failed to close sessions for ${serverId}: ${errMsg(err)}`);
  }
}

export function registerServerEventWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: GuildConfigSource,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, START_REGEX, () => {
    startTimes.set(serverId, new Date());
    void notifyEvent(
      client,
      guildConfigs,
      serverId,
      "start",
      () => t("serverEvent.startedTitle", { server: serverId }),
      ServerState.Online,
      () => t("serverEvent.startedBody"),
    );
  });

  registerServerEvent(logWatcher, STOP_REGEX, () => {
    noteServerStopping(serverId);
    closeSessions(serverId);
    let uptime: string | null = null;
    const started = startTimes.get(serverId);
    if (started) {
      uptime = formatSpan(Date.now() - started.getTime());
      startTimes.delete(serverId);
    }
    void notifyEvent(
      client,
      guildConfigs,
      serverId,
      "stop",
      () => t("serverEvent.stoppedTitle", { server: serverId }),
      ServerState.Offline,
      () =>
        t("serverEvent.stoppedBody") +
        (uptime ? `\n${t("serverEvent.uptime", { duration: uptime })}` : ""),
    );
  });
}

function notifyEvent(
  client: Client,
  guildConfigs: GuildConfigSource,
  serverId: string,
  event: NotificationEvent,
  title: () => string,
  state: ServerState,
  description: () => string,
): Promise<void> {
  return broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "serverEvents",
    // The title names the server, so no footer. A planned stop is a plain
    // event: the circle shows the state, the bar stays grey.
    buildEmbed: () =>
      createEmbed({
        title: title(),
        description: description(),
        state,
        ...(state === ServerState.Offline ? { color: EmbedColor.Neutral } : {}),
      }),
  });
}
