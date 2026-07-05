/**
 * /watch subscriptions — one-shot personal DMs, single owner of
 * data/watches.json.
 *
 *   kind "server": DM when the server comes back online (fired by the
 *                  downtime monitor's recovery branch)
 *   kind "player": DM when the player joins (fired by the join watcher)
 *
 * One-shot by design: a fired watch is removed, so nobody accumulates a
 * notification subscription they forgot about. Re-arm by running /watch
 * again. Store shape:
 *
 *   { "version": 1, "watches": [{ "id", "userId", "kind",
 *     "serverId", "player"?, "createdAt" }] }
 */
import path from "path";
import { randomBytes } from "crypto";
import { loadJson, saveJson, getRootDir } from "./utils.js";

const WATCHES_PATH = path.resolve(getRootDir(), "data", "watches.json");

/** Per-user cap so the file (and one user's DM burst) stays bounded. */
export const MAX_WATCHES_PER_USER = 10;

export type WatchKind = "server" | "player";

export interface Watch {
  id: string;
  userId: string;
  kind: WatchKind;
  serverId: string;
  /** Lowercased player name; only for kind "player". */
  player?: string;
  createdAt: number;
}

export interface WatchStore {
  version: 1;
  watches: Watch[];
}

function isV1Store(raw: unknown): raw is WatchStore {
  return (
    typeof raw === "object" &&
    raw !== null &&
    (raw as { version?: unknown }).version === 1 &&
    Array.isArray((raw as { watches?: unknown }).watches)
  );
}

export async function loadWatchStore(): Promise<WatchStore> {
  const raw = await loadJson(WATCHES_PATH).catch(() => ({}));
  if (isV1Store(raw)) return raw;
  return { version: 1, watches: [] };
}

export async function saveWatchStore(store: WatchStore): Promise<void> {
  return saveJson(WATCHES_PATH, store);
}

export function newWatchId(): string {
  return randomBytes(3).toString("hex");
}

/**
 * Remove-and-return every watch matching an event. Callers DM the
 * returned entries; the store is already saved without them (one-shot).
 */
export async function takeMatchingWatches(event: {
  kind: WatchKind;
  serverId: string;
  player?: string;
}): Promise<Watch[]> {
  const store = await loadWatchStore();
  const lowerPlayer = event.player?.toLowerCase();

  const matched: Watch[] = [];
  const rest: Watch[] = [];
  for (const watch of store.watches) {
    const hit =
      watch.kind === event.kind &&
      watch.serverId === event.serverId &&
      (watch.kind === "server" || watch.player === lowerPlayer);
    (hit ? matched : rest).push(watch);
  }

  if (matched.length > 0) {
    store.watches = rest;
    await saveWatchStore(store);
  }
  return matched;
}
