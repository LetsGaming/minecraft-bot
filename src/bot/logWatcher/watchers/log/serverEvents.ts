import { type Client } from "discord.js";
import { createEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import type { ILogWatcher } from "../../logWatcher.js";
import type { NotificationEvent } from "@mcbot/schema";
import { broadcastNotification } from "../notifyGuilds.js";
import type { GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  loadSessionStore,
  saveSessionStore,
  closeAllOpenSessions,
} from "@mcbot/core/utils/stores/sessionStore.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

import { t } from "@mcbot/core/utils/i18n.js";
// SEC-01: anchored on the server thread tag — a chat message must not
// forge start/stop (a forged stop closes every open play session).
const START_REGEX = serverEventRegex(String.raw`Done \([\d.]+s\)!`);
const STOP_REGEX = serverEventRegex(String.raw`Stopping server`);

const startTimes = new Map<string, Date>();

/**
 * A stopping server disconnects everyone without emitting per-player
 * leave lines, so every open session must be closed here — otherwise a
 * shutdown produces sessions that never end. Crashes (no "Stopping
 * server" line at all) are covered by the downtime monitor's offline
 * transition doing the same.
 */
async function closeSessions(serverId: string): Promise<void> {
  try {
    const store = await loadSessionStore();
    const closed = closeAllOpenSessions(store, serverId);
    if (closed > 0) {
      await saveSessionStore(store);
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

  registerServerEvent(logWatcher, START_REGEX, async () => {
    startTimes.set(serverId, new Date());
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "start",
      () => t("serverEvent.startedTitle"),
      EmbedColor.Success,
      () => t("serverEvent.startedBody"),
    );
  });

  registerServerEvent(logWatcher, STOP_REGEX, async () => {
    await closeSessions(serverId);
    let uptime: { h: number; m: number } | null = null;
    const started = startTimes.get(serverId);
    if (started) {
      const seconds = Math.floor((Date.now() - started.getTime()) / 1000);
      uptime = {
        h: Math.floor(seconds / 3600),
        m: Math.floor((seconds % 3600) / 60),
      };
      startTimes.delete(serverId);
    }
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "stop",
      () => t("serverEvent.stoppedTitle"),
      EmbedColor.Error,
      () =>
        t("serverEvent.stoppedBody") +
        (uptime ? `\n${t("serverEvent.uptime", uptime)}` : ""),
    );
  });
}

async function notifyEvent(
  client: Client,
  guildConfigs: GuildConfigSource,
  serverId: string,
  event: NotificationEvent,
  title: () => string,
  color: number,
  description: () => string,
): Promise<void> {
  await broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "serverEvents",
    buildEmbed: (withServerFooter) =>
      createEmbed({
        title: title(),
        description: description(),
        color,
        ...(withServerFooter ? { footer: { text: serverId } } : {}),
      }),
  });
}
