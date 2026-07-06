/**
 * Admin-action audit log.
 *
 * Records every admin-gated mutating action (/server start|stop|restart|
 * backup|prune-stats, /config reload, dashboard operations) with who did
 * it, from which guild, and against which server — the accountability
 * layer that per-guild admin scoping needs once the bot is shared across
 * communities.
 *
 * Backed by SQLite (admin_audit table). This store moved off JSON first,
 * deliberately: it is the one store BOTH processes write, and the
 * per-process saveJson chain could silently drop an entry when a
 * dashboard action raced a bot-side one. An INSERT under WAL cannot.
 *
 * Recording stays best-effort by design — an audit-write failure must
 * never block the admin action itself; it is logged instead.
 */
import { getDb, withTransaction } from "../db/index.js";
import { formatDatetime } from "./time.js";
import { log } from "./logger.js";

/** Keep the newest N entries — enough for "who restarted the server last
 *  month", bounded so the table can't grow forever. */
const MAX_ENTRIES = 500;

export interface AdminAuditEntry {
  at: string;
  action: string;
  server: string | null;
  by: string;
  byId: string;
  guildId: string | null;
  detail?: string;
}

interface AdminAuditRow {
  at: string;
  action: string;
  server: string | null;
  by_tag: string;
  by_id: string;
  guild_id: string | null;
  detail: string | null;
}

/** All retained entries, oldest first (the order the JSON array had). */
export async function loadAdminAudit(): Promise<AdminAuditEntry[]> {
  const rows = getDb()
    .prepare(
      `SELECT at, action, server, by_tag, by_id, guild_id, detail
       FROM admin_audit ORDER BY id ASC`,
    )
    .all() as unknown as AdminAuditRow[];
  return rows.map((r) => ({
    at: r.at,
    action: r.action,
    server: r.server,
    by: r.by_tag,
    byId: r.by_id,
    guildId: r.guild_id,
    ...(r.detail ? { detail: r.detail } : {}),
  }));
}

/**
 * Record an admin action. Never throws — auditing must not break the
 * action being audited.
 */
export async function recordAdminAction(entry: {
  action: string;
  server?: string | null;
  by: string;
  byId: string;
  guildId?: string | null;
  detail?: string;
}): Promise<void> {
  try {
    withTransaction(() => {
      const db = getDb();
      db.prepare(
        `INSERT INTO admin_audit (at, action, server, by_tag, by_id, guild_id, detail)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        formatDatetime(),
        entry.action,
        entry.server ?? null,
        entry.by,
        entry.byId,
        entry.guildId ?? null,
        entry.detail ?? null,
      );
      // Retention cap, same semantics as the old slice(-MAX_ENTRIES).
      db.prepare(
        `DELETE FROM admin_audit WHERE id NOT IN
           (SELECT id FROM admin_audit ORDER BY id DESC LIMIT ?)`,
      ).run(MAX_ENTRIES);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("adminAudit", `Failed to record "${entry.action}": ${msg}`);
  }
}
