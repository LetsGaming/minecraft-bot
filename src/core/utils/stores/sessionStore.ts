/**
 * Per-player session tracking: single owner of the player_sessions table.
 *
 * Fed by the joinLeave watcher (join opens, leave closes) plus the server
 * lifecycle: a "Stopping server" event and a downtime-monitor offline
 * transition both close every open session, because a crash never emits
 * leave lines. Without that, crashed sessions would stay open forever.
 *
 * One row per join, kept by age (SESSION_RETENTION_DAYS) and pruned by
 * pruneSessions. `left_at` is NULL while the session is open.
 *
 * A join while a session is already open means the leave was missed (bot
 * restart, dropped log lines). Such a stale session has no trustworthy
 * end, so it is discarded rather than closed with an invented timestamp.
 *
 * Names are external input and only ever bound as SQL parameters, so a
 * player called "__proto__" is an ordinary row.
 */
import { getDb, withTransaction } from "../../db/index.js";
import { mapRow, mapRows, col } from "../../db/rows.js";
import {
  ANALYTICS_RETENTION_DAYS,
} from "@mcbot/schema/analytics.js";
import { MS } from "@mcbot/schema/time.js";

export const SESSION_RETENTION_DAYS = ANALYTICS_RETENTION_DAYS.sessions;

export interface PlayerSession {
  joinedAt: number;
  /** null = session still open (player online, as far as the bot knows). */
  leftAt: number | null;
}

export interface PlayerSummary {
  /** Casing from the player's most recent join. */
  name: string;
  online: boolean;
  /** Timestamp of the last session end; null until the first leave. */
  lastSeen: number | null;
  /** Start of the oldest retained session. */
  firstSeen: number | null;
  /** Sessions overlapping the requested window (all retained by default). */
  sessions: number;
  /** Playtime inside the requested window; open sessions count to now. */
  playtimeMs: number;
}

export function openSession(
  serverId: string,
  player: string,
  at: number = Date.now(),
): void {
  const lower = player.toLowerCase();
  withTransaction(() => {
    const db = getDb();
    // Discard stale opens (missed leave); see module comment.
    db.prepare(
      `DELETE FROM player_sessions
       WHERE server_id = ? AND name_lower = ? AND left_at IS NULL`,
    ).run(serverId, lower);
    db.prepare(
      `INSERT INTO player_sessions (server_id, name_lower, name, joined_at, left_at)
       VALUES (?, ?, ?, ?, NULL)`,
    ).run(serverId, lower, player, at);
  });
}

/** Close the player's open session; returns false when none was open. */
export function closeSession(
  serverId: string,
  player: string,
  at: number = Date.now(),
): boolean {
  const result = getDb()
    .prepare(
      `UPDATE player_sessions SET left_at = ?
       WHERE id = (
         SELECT id FROM player_sessions
         WHERE server_id = ? AND name_lower = ? AND left_at IS NULL
         ORDER BY joined_at ASC LIMIT 1
       )`,
    )
    .run(at, serverId, player.toLowerCase());
  return Number(result.changes) > 0;
}

/**
 * Close every open session on a server: server stop, crash detected by
 * the downtime monitor, or any other "everyone just got disconnected"
 * moment. Returns how many sessions were closed.
 */
export function closeAllOpenSessions(
  serverId: string,
  at: number = Date.now(),
): number {
  const result = getDb()
    .prepare(
      "UPDATE player_sessions SET left_at = ? WHERE server_id = ? AND left_at IS NULL",
    )
    .run(at, serverId);
  return Number(result.changes);
}

/** Drop closed sessions older than the retention window. Open ones are never pruned. */
export function pruneSessions(now: number = Date.now()): number {
  const result = getDb()
    .prepare(
      "DELETE FROM player_sessions WHERE left_at IS NOT NULL AND left_at < ?",
    )
    .run(now - SESSION_RETENTION_DAYS * MS.day);
  return Number(result.changes);
}

export type PlayerStatusFilter = "all" | "online" | "quiet" | "new";
export type PlayerSortField =
  | "name"
  | "playtimeMs"
  | "sessions"
  | "lastSeen"
  | "firstSeen";

export interface PlayerListOptions {
  /** Window start (epoch ms); sessions and playtime are counted from here. */
  sinceMs?: number;
  now?: number;
  /** Case-insensitive substring of the player name. */
  q?: string;
  /**
   * all: played inside the window. online: connected now. quiet: not online
   * and last seen before `quietBeforeMs` (ignores the window). new: first
   * session starts inside the window.
   */
  status?: PlayerStatusFilter;
  quietBeforeMs?: number;
  sort?: PlayerSortField;
  order?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

const SORT_SQL: Record<PlayerSortField, string> = {
  name: "name COLLATE NOCASE",
  playtimeMs: "playtime",
  sessions: "sessions",
  lastSeen: "last_seen",
  firstSeen: "first_seen",
};

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function summaryOf(row: Record<string, unknown>): PlayerSummary {
  return {
    name: col.text(row, "name"),
    online: col.int(row, "online") === 1,
    lastSeen: col.intOrNull(row, "last_seen"),
    firstSeen: col.intOrNull(row, "first_seen"),
    sessions: col.int(row, "sessions"),
    playtimeMs: col.int(row, "playtime"),
  };
}

/**
 * Per-player aggregate for the window [?since, ?now]. Binds `now` and `since`
 * once (in that order, ahead of any parameter in `where`) through a one-row
 * CTE, because the two SQLite drivers disagree about reusing numbered `?N`
 * placeholders.
 */
function aggregateSql(where: string): string {
  return `
    WITH prm AS (SELECT ? AS p_now, ? AS p_since)
    SELECT p.name_lower AS pkey,
      (SELECT n.name FROM player_sessions n
        WHERE n.server_id = p.server_id AND n.name_lower = p.name_lower
        ORDER BY n.joined_at DESC LIMIT 1) AS name,
      MAX(CASE WHEN p.left_at IS NULL THEN 1 ELSE 0 END) AS online,
      MAX(p.left_at) AS last_seen,
      MIN(p.joined_at) AS first_seen,
      COALESCE(SUM(CASE
        WHEN p.joined_at < prm.p_now AND COALESCE(p.left_at, prm.p_now) > prm.p_since
        THEN 1 ELSE 0 END), 0) AS sessions,
      COALESCE(SUM(CASE
        WHEN p.joined_at < prm.p_now AND COALESCE(p.left_at, prm.p_now) > prm.p_since
        THEN MIN(COALESCE(p.left_at, prm.p_now), prm.p_now) - MAX(p.joined_at, prm.p_since)
        ELSE 0 END), 0) AS playtime
    FROM player_sessions p CROSS JOIN prm
    WHERE ${where}
    GROUP BY p.name_lower`;
}

/** One player's summary, or null when the bot has no retained session for them. */
export function getPlayerSummary(
  serverId: string,
  player: string,
  opts: { sinceMs?: number; now?: number } = {},
): PlayerSummary | null {
  const now = opts.now ?? Date.now();
  return mapRow(
    getDb().prepare(
      aggregateSql("p.server_id = ? AND p.name_lower = ?"),
    ),
    summaryOf,
    now,
    opts.sinceMs ?? 0,
    serverId,
    player.toLowerCase(),
  );
}

/** Every player on a server keyed by lowercased name, all retained history. */
export function getServerSummaries(
  serverId: string,
  now: number = Date.now(),
): Record<string, PlayerSummary> {
  const out: Record<string, PlayerSummary> = Object.create(null) as Record<
    string,
    PlayerSummary
  >;
  const rows = mapRows(
    getDb().prepare(aggregateSql("p.server_id = ?")),
    (r) => ({ key: col.text(r, "pkey"), summary: summaryOf(r) }),
    now,
    0,
    serverId,
  );
  for (const row of rows) out[row.key] = row.summary;
  return out;
}

/** A page of players with the total number that match the filters. */
export function listPlayerSummaries(
  serverId: string,
  opts: PlayerListOptions = {},
): { rows: PlayerSummary[]; total: number } {
  const now = opts.now ?? Date.now();
  const since = opts.sinceMs ?? 0;
  const status = opts.status ?? "all";

  let where = "p.server_id = ?";
  const params: unknown[] = [now, since, serverId];
  const q = opts.q?.trim().toLowerCase();
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    where += ` AND p.name_lower LIKE ? ESCAPE '\\'`;
  }

  const having: string[] = [];
  if (status === "all") having.push("sessions > 0");
  else if (status === "online") having.push("online = 1");
  else if (status === "quiet") {
    params.push(opts.quietBeforeMs ?? now);
    having.push("online = 0 AND last_seen < ?");
  } else {
    params.push(since);
    having.push("first_seen >= ?");
  }

  const inner = `SELECT * FROM (${aggregateSql(where)}) WHERE ${having.join(" AND ")}`;
  const db = getDb();
  const total =
    mapRow(db.prepare(`SELECT COUNT(*) AS n FROM (${inner})`), (r) => col.int(r, "n"), ...params) ??
    0;

  const order = opts.order === "asc" ? "ASC" : "DESC";
  const sortSql = SORT_SQL[opts.sort ?? "playtimeMs"];
  const sorted =
    opts.sort === "lastSeen"
      ? `online DESC, last_seen ${order}`
      : `${sortSql} ${order}`;
  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = mapRows(
    db.prepare(`${inner} ORDER BY ${sorted}, pkey ASC LIMIT ${limit} OFFSET ${offset}`),
    summaryOf,
    ...params,
  );
  return { rows, total };
}

/** A player's sessions, newest first. `sinceMs` keeps sessions that ended after it. */
export function listSessions(
  serverId: string,
  player: string,
  opts: { limit?: number; sinceMs?: number } = {},
): PlayerSession[] {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 5000));
  return mapRows(
    getDb().prepare(
      `SELECT joined_at, left_at FROM player_sessions
       WHERE server_id = ? AND name_lower = ?
         AND (left_at IS NULL OR left_at > ?)
       ORDER BY joined_at DESC LIMIT ${limit}`,
    ),
    (r) => ({
      joinedAt: col.int(r, "joined_at"),
      leftAt: col.intOrNull(r, "left_at"),
    }),
    serverId,
    player.toLowerCase(),
    opts.sinceMs ?? 0,
  );
}

export interface PlayerPresence {
  serverId: string;
  online: boolean;
  lastSeen: number | null;
}

/** Where a name has been seen, across every server. */
export function presenceAcrossServers(player: string): PlayerPresence[] {
  return mapRows(
    getDb().prepare(
      `SELECT server_id,
         MAX(CASE WHEN left_at IS NULL THEN 1 ELSE 0 END) AS online,
         MAX(left_at) AS last_seen
       FROM player_sessions WHERE name_lower = ? GROUP BY server_id`,
    ),
    (r) => ({
      serverId: col.text(r, "server_id"),
      online: col.int(r, "online") === 1,
      lastSeen: col.intOrNull(r, "last_seen"),
    }),
    player.toLowerCase(),
  );
}
