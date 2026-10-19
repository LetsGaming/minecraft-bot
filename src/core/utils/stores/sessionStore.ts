/**
 * Per-player session tracking: single owner of kv_store["sessions"].
 *
 * Fed by the joinLeave watcher (join opens, leave closes) plus the server
 * lifecycle: a "Stopping server" event and a downtime-monitor offline
 * transition both close every open session, because a crash never emits
 * leave lines. Without that, crashed sessions would stay open forever.
 *
 * Storage shape (per server, keyed by lowercased player name, ring buffer
 * of the last N sessions per player, same bounded-history pattern as the
 * 30-claim daily history):
 *
 *   { "version": 1, "servers": { "<id>": { "<player>": {
 *       "name": "...", "lastSeen": 123, "sessions": [{joinedAt, leftAt}] } } } }
 *
 * A join while a session is already open means the leave was missed (bot
 * restart, dropped log lines). Such a stale session has no trustworthy
 * end, so it is discarded rather than closed with an invented timestamp.
 *
 * Player names are external input, so the maps have no prototype: a player
 * called "__proto__" or "constructor" is an ordinary key.
 */
import { versionedStore } from "./versionedStore.js";
import { createRecord, ownGet, ownSet, toRecord } from "./safeRecord.js";

/** Keep the newest N sessions per player. */
export const MAX_SESSIONS_PER_PLAYER = 20;

export interface PlayerSession {
  joinedAt: number;
  /** null = session still open (player online, as far as the bot knows). */
  leftAt: number | null;
}

export interface PlayerSessionEntry {
  /** Last-seen casing of the name (lookups are case-insensitive). */
  name: string;
  /** Timestamp of the last session end; null until the first leave. */
  lastSeen: number | null;
  /** Oldest first, newest last. */
  sessions: PlayerSession[];
}

/** serverId → lowercased player name → entry */
export type ServerSessionsMap = Record<string, PlayerSessionEntry>;

export interface SessionStore {
  version: 1;
  servers: Record<string, ServerSessionsMap>;
}

const sessionDoc = versionedStore<SessionStore>(
  "sessions",
  { version: 1, container: "servers" },
  () => ({ version: 1, servers: createRecord() }),
  (doc) => {
    doc.servers = toRecord(doc.servers);
    for (const serverId of Object.keys(doc.servers)) {
      doc.servers[serverId] = toRecord(doc.servers[serverId]!);
    }
    return doc;
  },
);

/** Read-only snapshot. To change sessions use updateSessionStore. */
export async function loadSessionStore(): Promise<SessionStore> {
  return sessionDoc.load();
}

/** Change the sessions in one transaction; see versionedStore. */
export function updateSessionStore<T>(fn: (store: SessionStore) => T): T {
  return sessionDoc.update(fn);
}

/** Sessions for one server; creates the map lazily so callers can mutate. */
export function getServerSessions(
  store: SessionStore,
  serverId: string,
): ServerSessionsMap {
  let map = ownGet(store.servers, serverId);
  if (!map) {
    map = createRecord<PlayerSessionEntry>();
    ownSet(store.servers, serverId, map);
  }
  return map;
}

function trim(entry: PlayerSessionEntry): void {
  if (entry.sessions.length > MAX_SESSIONS_PER_PLAYER) {
    entry.sessions = entry.sessions.slice(-MAX_SESSIONS_PER_PLAYER);
  }
}

export function openSession(
  store: SessionStore,
  serverId: string,
  player: string,
  at: number = Date.now(),
): void {
  const players = getServerSessions(store, serverId);
  const key = player.toLowerCase();
  let entry = ownGet(players, key);
  if (!entry) {
    entry = { name: player, lastSeen: null, sessions: [] };
    ownSet(players, key, entry);
  }
  entry.name = player; // keep the most recent casing

  // Discard stale opens (missed leave); see module comment.
  entry.sessions = entry.sessions.filter((s) => s.leftAt !== null);
  entry.sessions.push({ joinedAt: at, leftAt: null });
  trim(entry);
}

/** Close the player's open session; returns false when none was open. */
export function closeSession(
  store: SessionStore,
  serverId: string,
  player: string,
  at: number = Date.now(),
): boolean {
  const entry = ownGet(getServerSessions(store, serverId), player.toLowerCase());
  const open = entry?.sessions.find((s) => s.leftAt === null);
  if (!entry || !open) return false;
  open.leftAt = at;
  entry.lastSeen = at;
  return true;
}

/**
 * Close every open session on a server: server stop, crash detected by
 * the downtime monitor, or any other "everyone just got disconnected"
 * moment. Returns how many sessions were closed.
 */
export function closeAllOpenSessions(
  store: SessionStore,
  serverId: string,
  at: number = Date.now(),
): number {
  let closed = 0;
  for (const entry of Object.values(getServerSessions(store, serverId))) {
    for (const s of entry.sessions) {
      if (s.leftAt === null) {
        s.leftAt = at;
        entry.lastSeen = at;
        closed++;
      }
    }
  }
  return closed;
}

export function isOnlineNow(entry: PlayerSessionEntry): boolean {
  return entry.sessions.some((s) => s.leftAt === null);
}

/** Total playtime across recorded sessions; open sessions count to `now`. */
export function totalPlaytimeMs(
  entry: PlayerSessionEntry,
  now: number = Date.now(),
): number {
  return entry.sessions.reduce(
    (sum, s) => sum + Math.max(0, (s.leftAt ?? now) - s.joinedAt),
    0,
  );
}
