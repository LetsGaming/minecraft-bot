import { type Client } from "discord.js";
import { createEmbed } from "../../utils/embedUtils.js";
import type { ILogWatcher } from "../logWatcher.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";
import { broadcastNotification } from "./notifyGuilds.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  loadSessionStore,
  saveSessionStore,
  closeAllOpenSessions,
} from "@mcbot/core/utils/sessionStore.js";
import { log } from "@mcbot/core/utils/logger.js";

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
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("sessions", `Failed to close sessions for ${serverId}: ${msg}`);
  }
}

export function registerServerEventWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, START_REGEX, async () => {
    startTimes.set(serverId, new Date());
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "start",
      "🟢 Server Started",
      0x55ff55,
      "Server is now online and ready for players.",
    );
  });

  registerServerEvent(logWatcher, STOP_REGEX, async () => {
    await closeSessions(serverId);
    let uptimeMsg = "";
    const started = startTimes.get(serverId);
    if (started) {
      const uptime = Math.floor((Date.now() - started.getTime()) / 1000);
      const h = Math.floor(uptime / 3600);
      const m = Math.floor((uptime % 3600) / 60);
      uptimeMsg = `\nUptime: ${h}h ${m}m`;
      startTimes.delete(serverId);
    }
    await notifyEvent(
      client,
      guildConfigs,
      serverId,
      "stop",
      "🔴 Server Stopped",
      0xff5555,
      `Server is shutting down.${uptimeMsg}`,
    );
  });
}

async function notifyEvent(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  serverId: string,
  event: string,
  title: string,
  color: number,
  description: string,
): Promise<void> {
  await broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "serverEvents",
    buildEmbed: (withServerFooter) =>
      createEmbed({
        title,
        description,
        color,
        ...(withServerFooter ? { footer: { text: serverId } } : {}),
      }),
  });
}
