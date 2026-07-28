/**
 * Timed-ban release — the runtime half of tempBanStore.
 *
 * One timer per pending ban fires the `/pardon`. startTempBanScheduler
 * re-arms every entry at bot init, so a restart mid-ban still releases on
 * time — and a ban that expired while the bot was down is released on the
 * next start instead of silently becoming permanent.
 *
 * setTimeout tops out at ~24.8 days, well under the durations this
 * accepts, so the wait goes through scheduleAt (core/utils/longTimer).
 *
 * If the player has a linked Discord account they get a DM when the ban
 * lifts. Best-effort by design: a closed DM must never stop the pardon.
 */
import {
  loadTempBanStore,
  listTempBans,
  removeTempBan,
  tempBanKey,
  type TempBan,
} from "@mcbot/core/utils/stores/tempBanStore.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import {
  loadLinkedAccountsOrEmpty,
  findDiscordIdByMcName,
} from "@mcbot/core/utils/stores/linkUtils.js";
import { t } from "@mcbot/core/utils/i18n.js";
import type { Client } from "discord.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { scheduleAt, type LongTimer } from "@mcbot/core/utils/longTimer.js";
import { log } from "@mcbot/core/utils/logger.js";
import { errMsg } from "@mcbot/core/utils/error.js";

const timers = new Map<string, LongTimer>();

/** Exposed for tests. */
export function _resetStateForTesting(): void {
  for (const timer of timers.values()) timer.cancel();
  timers.clear();
}

/** Cancel a pending release (manual /pardon beat the clock). */
export function cancelTempBanTimer(serverId: string, player: string): void {
  const key = tempBanKey(serverId, player);
  timers.get(key)?.cancel();
  timers.delete(key);
}

/**
 * DM the linked Discord account that the ban has lifted.
 *
 * Best-effort: unlinked players, closed DMs, and deleted accounts are all
 * normal outcomes here, so nothing throws upward. The DM follows the
 * global language — like every other DM, there is no guild to resolve a
 * locale from.
 */
async function notifyPlayer(client: Client, ban: TempBan): Promise<void> {
  try {
    const linked = await loadLinkedAccountsOrEmpty();
    const discordId = findDiscordIdByMcName(linked, ban.player);
    if (!discordId) return;

    const user = await client.users.fetch(discordId);
    await user.send(
      t("tempban.dmExpired", { player: ban.player, server: ban.serverId }),
    );
  } catch (err) {
    log.debug("tempban", `Expiry DM for ${ban.player} failed: ${errMsg(err)}`);
  }
}

/** Arm (or re-arm) the release timer for one ban. */
export function armTempBan(client: Client, ban: TempBan): void {
  const key = tempBanKey(ban.serverId, ban.player);
  cancelTempBanTimer(ban.serverId, ban.player);

  const timer = scheduleAt(ban.expiresAt, () => {
    timers.delete(key);
    void expireTempBan(client, ban).catch((err: unknown) => {
      log.error("tempban", `Failed to release ${ban.player}: ${errMsg(err)}`);
    });
  });
  timers.set(key, timer);
}

/** Issue the pardon and drop the entry. Idempotent. */
export async function expireTempBan(
  client: Client,
  ban: TempBan,
): Promise<void> {
  const server = getServerInstance(ban.serverId);
  if (!server) {
    // Instance gone from config — nothing to pardon on, so stop tracking
    // it rather than retrying forever.
    await removeTempBan(ban.serverId, ban.player);
    log.warn(
      "tempban",
      `Dropping expired ban for ${ban.player}: server ${ban.serverId} no longer configured`,
    );
    return;
  }

  await server.sendCommand(`/pardon ${ban.player}`);
  await removeTempBan(ban.serverId, ban.player);

  await recordAdminAction({
    action: "tempban-expired",
    server: ban.serverId,
    by: "system",
    byId: "system",
    guildId: null,
    detail: `${ban.player} (banned by ${ban.by})`,
  });

  await notifyPlayer(client, ban);

  log.info("tempban", `Released ${ban.player} on ${ban.serverId}`);
}

/** Re-arm every pending release at startup; release overdue ones now. */
export function startTempBanScheduler(client: Client): void {
  void (async () => {
    try {
      const store = await loadTempBanStore();
      const bans = listTempBans(store);
      for (const ban of bans) {
        if (ban.expiresAt <= Date.now()) {
          await expireTempBan(client, ban).catch((err: unknown) => {
            log.error(
              "tempban",
              `Failed to release overdue ban for ${ban.player}: ${errMsg(err)}`,
            );
          });
        } else {
          armTempBan(client, ban);
        }
      }
      if (bans.length > 0) {
        log.info("tempban", `Resumed ${bans.length} timed ban(s)`);
      }
    } catch (err) {
      log.error("tempban", `Failed to resume timed bans: ${errMsg(err)}`);
    }
  })();
}
