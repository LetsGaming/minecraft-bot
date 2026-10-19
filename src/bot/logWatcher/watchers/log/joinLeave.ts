import { type Client } from "discord.js";
import { EmbedCategory } from "@mcbot/schema/embedCategories.js";
import { createPlayerEmbed } from "../../../utils/embeds/embedUtils.js";
import type { ILogWatcher } from "../../logWatcher.js";
import { broadcastNotification } from "../notifyGuilds.js";
import type { GuildConfigSource } from "../../../utils/guild/guildConfigs.js";
import { serverEventRegex, registerServerEvent } from "./serverLine.js";
import {
  openSession,
  closeSession,
} from "@mcbot/core/utils/stores/sessionStore.js";
import { deliverPendingRewards } from "@mcbot/core/utils/minecraft/rewards.js";
import {
  maybeNudge,
  NUDGE_DELAY_MS,
} from "@mcbot/core/utils/minecraft/featureNudges.js";
import { PLAYER_NAME } from "@mcbot/core/utils/sanitize.js";
import { MS } from "@mcbot/schema";
import { log } from "@mcbot/core/utils/logger.js";
import { fireWatches } from "../watchFirer.js";
import type { ServerInstance } from "@mcbot/core/utils/server/server.js";
import { errMsg } from "@mcbot/core/utils/error.js";
import { t } from "@mcbot/core/utils/i18n.js";

// PLAYER_NAME covers Bedrock names prefixed with "." by Geyser/Floodgate in
// addition to vanilla [a-zA-Z0-9_] names. Anchored on the server thread tag:
// chat must not forge join/leave events (they open/close sessions and
// deliver rewards).
const JOIN_REGEX = serverEventRegex(String.raw`(${PLAYER_NAME}) joined the game`);
const LEAVE_REGEX = serverEventRegex(String.raw`(${PLAYER_NAME}) left the game`);

/**
 * How long a freshly joined player gets to finish logging in before the
 * queued-reward /give lands: a give during login can miss the inventory.
 */
const DELIVERY_DELAY_MS = 2 * MS.second;

function recordSession(serverId: string, player: string, event: "join" | "leave"): void {
  try {
    if (event === "join") openSession(serverId, player);
    else closeSession(serverId, player);
  } catch (err) {
    log.warn("sessions", `Failed to record ${event} for ${player}: ${errMsg(err)}`);
  }
}

/**
 * Deliver queued rewards a moment after the join. Fire-and-forget with its
 * own error handling: log handlers run serially, so sleeping inside the
 * handler would stall every other watcher.
 */
function scheduleRewardDelivery(server: ServerInstance, player: string): void {
  setTimeout(() => {
    void deliverPendingRewards(server, player).catch((err: unknown) => {
      log.warn("daily", `Pending-reward delivery for ${player} failed: ${errMsg(err)}`);
    });
  }, DELIVERY_DELAY_MS);
}

/**
 * Whisper a discoverability tip a little after the join, if this player is
 * missing a step of the link → daily funnel.
 *
 * Fire-and-forget on its own timer for the same reason as reward delivery.
 * Errors are swallowed inside maybeNudge: a tip is the least important thing
 * the bot does.
 */
function scheduleNudge(server: ServerInstance, player: string): void {
  setTimeout(() => {
    void maybeNudge(server, player);
  }, NUDGE_DELAY_MS).unref();
}

export function registerJoinLeaveWatcher(
  logWatcher: ILogWatcher,
  client: Client,
  guildConfigs: GuildConfigSource,
): void {
  const serverId = logWatcher.server.id;

  registerServerEvent(logWatcher, JOIN_REGEX, (match) => {
    const player = match[1]!;
    recordSession(serverId, player, "join");
    scheduleRewardDelivery(logWatcher.server, player);
    scheduleNudge(logWatcher.server, player);
    fireWatches(client, { kind: "player", serverId, player });
    void notify(client, guildConfigs, serverId, player, "join");
  });

  registerServerEvent(logWatcher, LEAVE_REGEX, (match) => {
    const player = match[1]!;
    recordSession(serverId, player, "leave");
    void notify(client, guildConfigs, serverId, player, "leave");
  });
}

/** Queues the embed per channel and returns once it has been sent; callers on the dispatch queue drop it. */
function notify(
  client: Client,
  guildConfigs: GuildConfigSource,
  serverId: string,
  player: string,
  event: "join" | "leave",
): Promise<void> {
  const isJoin = event === "join";
  return broadcastNotification(client, guildConfigs, {
    serverId,
    event,
    logTag: "joinLeave",
    buildEmbed: () =>
      createPlayerEmbed(player, {
        description: `${t(isJoin ? "watchers.joinEmoji" : "watchers.leaveEmoji")} ${t(
          isJoin ? "joinLeave.joined" : "joinLeave.left",
          { player, server: serverId },
        )}`,
        category: EmbedCategory.Presence,
      }),
  });
}
