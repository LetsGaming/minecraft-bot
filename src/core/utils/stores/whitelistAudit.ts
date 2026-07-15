/**
 * Whitelist audit trail — who added/removed which player, when, on which
 * server. One row per player (keyed by lowercased username), carrying the
 * latest add and the latest remove, exactly the shape the old JSON map had.
 *
 * Backed by SQLite (whitelist_audit table); each record operation is one
 * atomic UPSERT instead of the old load-whole-map / mutate / save-whole-map
 * round-trip.
 */
import { formatDatetime } from "../time.js";
import { getDb } from "../../db/index.js";
import { mapRow, mapRows, col } from "../../db/rows.js";
import type { WhitelistAuditEntry, WhitelistAuditMap } from "../../types/index.js";

interface AuditRow {
  username_lower: string;
  username: string | null;
  uuid: string | null;
  added_by: string | null;
  added_by_id: string | null;
  added_at: string | null;
  server: string | null;
  removed_by: string | null;
  removed_by_id: string | null;
  removed_at: string | null;
  removed_from_server: string | null;
}

// Explicit column list (never SELECT *) shared by both read paths so the
// mapper and the query can't drift apart.
const AUDIT_COLUMNS =
  "username_lower, username, uuid, added_by, added_by_id, added_at, " +
  "server, removed_by, removed_by_id, removed_at, removed_from_server";

function toAuditRow(r: Record<string, unknown>): AuditRow {
  return {
    username_lower: col.text(r, "username_lower"),
    username: col.textOrNull(r, "username"),
    uuid: col.textOrNull(r, "uuid"),
    added_by: col.textOrNull(r, "added_by"),
    added_by_id: col.textOrNull(r, "added_by_id"),
    added_at: col.textOrNull(r, "added_at"),
    server: col.textOrNull(r, "server"),
    removed_by: col.textOrNull(r, "removed_by"),
    removed_by_id: col.textOrNull(r, "removed_by_id"),
    removed_at: col.textOrNull(r, "removed_at"),
    removed_from_server: col.textOrNull(r, "removed_from_server"),
  };
}

function rowToEntry(r: AuditRow): WhitelistAuditEntry {
  const e: WhitelistAuditEntry = {};
  if (r.username !== null) e.username = r.username;
  if (r.uuid !== null) e.uuid = r.uuid;
  if (r.added_by !== null) e.addedBy = r.added_by;
  if (r.added_by_id !== null) e.addedById = r.added_by_id;
  if (r.added_at !== null) e.addedAt = r.added_at;
  if (r.server !== null) e.server = r.server;
  if (r.removed_by !== null) e.removedBy = r.removed_by;
  if (r.removed_by_id !== null) e.removedById = r.removed_by_id;
  if (r.removed_at !== null) e.removedAt = r.removed_at;
  if (r.removed_from_server !== null) e.removedFromServer = r.removed_from_server;
  return e;
}

/** Load the whole audit trail as the legacy map shape (lowercased keys). */
export async function loadAudit(): Promise<WhitelistAuditMap> {
  const rows = mapRows(
    getDb().prepare(`SELECT ${AUDIT_COLUMNS} FROM whitelist_audit`),
    toAuditRow,
  );
  const map: WhitelistAuditMap = {};
  for (const r of rows) map[r.username_lower] = rowToEntry(r);
  return map;
}

/** Record that a player was whitelisted. */
export async function recordAdd(
  username: string,
  discordTag: string,
  discordId: string,
  serverId: string,
  uuid: string | null = null,
): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO whitelist_audit
         (username_lower, username, uuid, added_by, added_by_id, added_at, server)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(username_lower) DO UPDATE SET
         username    = excluded.username,
         uuid        = COALESCE(excluded.uuid, whitelist_audit.uuid),
         added_by    = excluded.added_by,
         added_by_id = excluded.added_by_id,
         added_at    = excluded.added_at,
         server      = excluded.server`,
    )
    .run(
      username.toLowerCase(),
      username,
      uuid,
      discordTag,
      discordId,
      formatDatetime(),
      serverId,
    );
}

/** Record that a player was removed from the whitelist. */
export async function recordRemove(
  username: string,
  discordTag: string,
  discordId: string,
  serverId: string,
): Promise<void> {
  getDb()
    .prepare(
      `INSERT INTO whitelist_audit
         (username_lower, username, removed_by, removed_by_id, removed_at, removed_from_server)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username_lower) DO UPDATE SET
         removed_by          = excluded.removed_by,
         removed_by_id       = excluded.removed_by_id,
         removed_at          = excluded.removed_at,
         removed_from_server = excluded.removed_from_server`,
    )
    .run(
      username.toLowerCase(),
      username,
      discordTag,
      discordId,
      formatDatetime(),
      serverId,
    );
}

/** Get the audit entry for a specific player. */
export async function getAuditEntry(
  username: string,
): Promise<WhitelistAuditEntry | null> {
  return mapRow(
    getDb().prepare(
      `SELECT ${AUDIT_COLUMNS} FROM whitelist_audit WHERE username_lower = ?`,
    ),
    (r) => rowToEntry(toAuditRow(r)),
    username.toLowerCase(),
  );
}
