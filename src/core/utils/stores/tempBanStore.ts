/**
 * Timed bans, single owner of kv_store["tempBans"].
 *
 * Vanilla Minecraft has no temp-ban: `/ban` is forever and the ban list
 * carries no expiry. So the *ban* stays vanilla (the server enforces it
 * even while the bot is down) and only the *release* lives here, one
 * entry per pending expiry, which the scheduler turns into a `/pardon`
 * when its time comes.
 *
 * That keeps the roadmap's "no ban database of its own" boundary intact:
 * this is a release queue, not a ban record. Permanent bans write
 * nothing; /note still carries the per-player "why".
 *
 * Keyed by `<serverId>:<lowercased name>` because the vanilla ban list is
 * name-based, there is no UUID to hang this on at ban time, and a
 * re-ban of the same name on the same server should replace the pending
 * release rather than stack a second one.
 */
import { versionedStore } from "./versionedStore.js";

export interface TempBan {
  /** Name as typed, for display and the /pardon we will issue. */
  player: string;
  serverId: string;
  /** Epoch ms at which the pardon fires. */
  expiresAt: number;
  /** Epoch ms the ban was issued, display only. */
  bannedAt: number;
  /** Discord tag of the issuing admin, display only. */
  by: string;
  reason: string;
}

export interface TempBanStore {
  version: 1;
  /** `<serverId>:<lowercased player>` → entry */
  bans: Record<string, TempBan>;
}

export function tempBanKey(serverId: string, player: string): string {
  return `${serverId}:${player.toLowerCase()}`;
}

const banDoc = versionedStore<TempBanStore>(
  "tempBans",
  { version: 1, container: "bans" },
  () => ({ version: 1, bans: {} }),
);

export async function loadTempBanStore(): Promise<TempBanStore> {
  return banDoc.load();
}

/**
 * Record a pending release, replacing any earlier one for the same
 * player+server. Atomic, so a re-ban racing the expiry sweep can't lose.
 */
export async function putTempBan(ban: TempBan): Promise<void> {
  banDoc.update((store) => {
    store.bans[tempBanKey(ban.serverId, ban.player)] = ban;
  });
}

/** Drop a pending release. True when one existed (manual /pardon path). */
export async function removeTempBan(
  serverId: string,
  player: string,
): Promise<boolean> {
  return banDoc.update((store) => {
    const key = tempBanKey(serverId, player);
    const existed = key in store.bans;
    delete store.bans[key];
    return existed;
  });
}

export function listTempBans(store: TempBanStore): TempBan[] {
  return Object.values(store.bans).sort((a, b) => a.expiresAt - b.expiresAt);
}
