import { type Client } from "discord.js";
import { createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import { EmbedColor } from "../../../utils/embeds/embedColors.js";
import type { ILogWatcher } from "../../logWatcher.js";
import type { GuildConfig } from "@mcbot/core/types/index.js";
import { broadcastNotification, PLAYER_NAME } from "../notifyGuilds.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  loadSessionStore,
  saveSessionStore,
  openSession,
  closeSession,
} from "@mcbot/core/utils/stores/sessionStore.js";
import { deliverPendingRewards } from "../../../commands/connection/daily/daily.js";
import { log } from "@mcbot/core/utils/logger.js";
import { fireWatches } from "../watchFirer.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";

// PLAYER_NAME captures Bedrock names prefixed with "." by
// Geyser/Floodgate in addition to vanilla [a-zA-Z0-9_] names.
// SEC-01: anchored on the server thread tag — chat must not forge
// join/leave events (they open/close sessions and deliver rewards).
const JOIN_REGEX = serverEventRegex(String.raw`(${PLAYER_NAME}) joined the game`);
const LEAVE_REGEX = serverEventRegex(String.raw`(${PLAYER_NAME}) left the game`);

/**
 * Give a freshly joined player a moment to finish logging in before the
 * queued-reward /give lands — a give during login can miss the inventory.
 * Fire-and-forget with its own error handling: log handlers run serially,
 * so sleeping inside the handler would stall every other watcher.
 */
const DELIVERY_DELAY_MS = 2_000;

async function recordSession(
  serverId: string,
  player: string,
  event: "join" | "leave",
): Promise<void> {
  try {
    const store = await loadSessionStore();
    if (event === "join") openSession(store, serverId, player);
    else closeSession(store, serverId, player);
    await saveSessionStore(store);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("sessions", `Failed to record ${event} for ${player}: ${msg}`);
  }
}

function scheduleRewardDelivery(server: ServerInstance, player: string): void {
  setTimeout(() => {
    void deliverPendingRewards(server, player).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("daily", `Pending-reward delivery for ${player} failed: ${msg}`);
    });
  }, DELIVERY_DELAY_MS);
}

export function registerJoinLeaveWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, JOIN_REGEX, async (match) => {
    const player = match[1]!;
    await recordSession(serverId, player, "join");
    scheduleRewardDelivery(logWatcher.server, player);
    fireWatches(client, { kind: "player", serverId, player });
    await notify(client, guildConfigs, serverId, player, "join");
  });

  registerServerEvent(logWatcher, LEAVE_REGEX, async (match) => {
    const player = match[1]!;
    await recordSession(serverId, player, "leave");
    await notify(client, guildConfigs, serverId, player, "leave");
  });
}

async function notify(
  client: Client,
  guildConfigs: Record<string, GuildConfig>,
  serverId: string,
  player: string,
  event: "join" | "leave",
): Promise<void> {
  const isJoin = event === "join";
  await broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "joinLeave",
    buildEmbed: (withServerFooter) =>
      createPlayerEmbed(player, {
        title: isJoin ? "Player Joined" : "Player Left",
        description: `${player} ${isJoin ? "joined" : "left"} the server`,
        color: isJoin ? EmbedColor.Success : EmbedColor.Error,
        ...(withServerFooter ? { footer: { text: serverId } } : {}),
      }),
  });
}
