/**
 * Timed-ban release — the runtime half of tempBanStore.
 *
 * One timer per pending ban fires the `/pardon`. startTempBanScheduler
 * re-arms every entry at bot init, so a restart mid-ban still releases on
 * time — and a ban that expired while the bot was down is released on the
 * next start instead of silently becoming permanent.
 *
 * setTimeout tops out at ~24.8 days, well under the durations this
 * accepts, so long waits re-arm in chunks rather than firing early.
 */
import {
  loadTempBanStore,
  listTempBans,
  removeTempBan,
  tempBanKey,
  type TempBan,
} from "@mcbot/core/utils/stores/tempBanStore.js";
import { getServerInstance } from "@mcbot/core/utils/server/server.js";
import { recordAdminAction } from "@mcbot/core/utils/stores/adminAudit.js";
import { log } from "@mcbot/core/utils/logger.js";

const MAX_TIMEOUT_MS = 2 ** 31 - 1;

const timers = new Map<string, ReturnType<typeof setTimeout>>();

/** Exposed for tests. */
export function _resetStateForTesting(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

/** Cancel a pending release (manual /pardon beat the clock). */
export function cancelTempBanTimer(serverId: string, player: string): void {
  const key = tempBanKey(serverId, player);
  const timer = timers.get(key);
  if (timer) clearTimeout(timer);
  timers.delete(key);
}

/** Arm (or re-arm) the release timer for one ban. */
export function armTempBan(ban: TempBan): void {
  const key = tempBanKey(ban.serverId, ban.player);
  cancelTempBanTimer(ban.serverId, ban.player);

  const remaining = Math.max(0, ban.expiresAt - Date.now());
  const delay = Math.min(remaining, MAX_TIMEOUT_MS);
  const timer = setTimeout(() => {
    timers.delete(key);
    // Long ban: this tick was only a chunk of the wait, so arm the next.
    if (Date.now() < ban.expiresAt) {
      armTempBan(ban);
      return;
    }
    void expireTempBan(ban).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("tempban", `Failed to release ${ban.player}: ${msg}`);
    });
  }, delay);
  timers.set(key, timer);
}

/** Issue the pardon and drop the entry. Idempotent. */
export async function expireTempBan(ban: TempBan): Promise<void> {
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

  log.info("tempban", `Released ${ban.player} on ${ban.serverId}`);
}

/** Re-arm every pending release at startup; release overdue ones now. */
export function startTempBanScheduler(): void {
  void (async () => {
    try {
      const store = await loadTempBanStore();
      const bans = listTempBans(store);
      for (const ban of bans) {
        if (ban.expiresAt <= Date.now()) {
          await expireTempBan(ban).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            log.error(
              "tempban",
              `Failed to release overdue ban for ${ban.player}: ${msg}`,
            );
          });
        } else {
          armTempBan(ban);
        }
      }
      if (bans.length > 0) {
        log.info("tempban", `Resumed ${bans.length} timed ban(s)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error("tempban", `Failed to resume timed bans: ${msg}`);
    }
  })();
}
