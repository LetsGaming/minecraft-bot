/**
 * Advancement challenges — single owner of kv_store["challenges"] plus the
 * pure active/won/expired/cancelled state machine.
 *
 * One challenge can be active per server at a time. Expiry is lazy: there
 * is no scheduler; stale challenges flip to "expired" whenever the store
 * is consulted (advancement hook, /challenge status|start). Detection is
 * nearly free — the advancements watcher already parses every
 * "X has made the advancement Y" line; this store only decides whether a
 * parsed advancement wins something.
 *
 * History is kept per server (bounded) so /challenge status can show the
 * most recent outcome after a win.
 */
import { kvGet, kvSet } from "../db/kv.js";

/** Keep the newest N challenges per server. */
export const MAX_CHALLENGE_HISTORY = 20;

export type ChallengeStatus = "active" | "won" | "expired" | "cancelled";

export interface Challenge {
  /** Advancement display name exactly as it appears in chat, e.g. "Stone Age".
   *  Matching is case-insensitive. */
  advancement: string;
  /** Free-text reward description shown in announcements. */
  reward?: string;
  /** Optional item bonus delivered through the daily give() path. */
  item?: string;
  amount?: number;
  startedBy: string;
  startedById: string;
  startedAt: number;
  /** Unset = challenge runs until won or cancelled. */
  endsAt?: number;
  status: ChallengeStatus;
  wonBy?: string;
  wonAt?: number;
}

export interface ChallengeStore {
  version: 1;
  /** serverId → challenges, oldest first. */
  servers: Record<string, Challenge[]>;
}

function isV1Store(raw: unknown): raw is ChallengeStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    typeof (raw as { servers?: unknown }).servers === "object" &&
    (raw as { servers?: unknown }).servers !== null
  );
}

export async function loadChallengeStore(): Promise<ChallengeStore> {
  const raw = kvGet<unknown>("challenges");
  if (isV1Store(raw)) return raw;
  return { version: 1, servers: {} };
}

export async function saveChallengeStore(
  store: ChallengeStore,
): Promise<void> {
  kvSet("challenges", store);
}

export function getServerChallenges(
  store: ChallengeStore,
  serverId: string,
): Challenge[] {
  return (store.servers[serverId] ??= []);
}

/** Flip past-deadline active challenges to expired. Returns true when the
 *  store changed (caller should save). */
export function expireStale(
  store: ChallengeStore,
  serverId: string,
  now: number = Date.now(),
): boolean {
  let changed = false;
  for (const c of getServerChallenges(store, serverId)) {
    if (c.status === "active" && c.endsAt !== undefined && c.endsAt <= now) {
      c.status = "expired";
      changed = true;
    }
  }
  return changed;
}

export function getActiveChallenge(
  store: ChallengeStore,
  serverId: string,
): Challenge | null {
  return (
    getServerChallenges(store, serverId).find((c) => c.status === "active") ??
    null
  );
}

/** Most recent challenge regardless of status (for /challenge status). */
export function getLatestChallenge(
  store: ChallengeStore,
  serverId: string,
): Challenge | null {
  const list = getServerChallenges(store, serverId);
  return list[list.length - 1] ?? null;
}

export function addChallenge(
  store: ChallengeStore,
  serverId: string,
  challenge: Challenge,
): void {
  const list = getServerChallenges(store, serverId);
  list.push(challenge);
  store.servers[serverId] = list.slice(-MAX_CHALLENGE_HISTORY);
}
