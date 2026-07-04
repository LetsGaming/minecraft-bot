/**
 * Admin-action audit log.
 *
 * Records every admin-gated mutating action (/server start|stop|restart|
 * backup|prune-stats, /config reload) with who did it, from which guild,
 * and against which server — the accountability layer that per-guild admin
 * scoping needs once the bot is shared across communities.
 *
 * Follows the whitelistAudit.ts pattern: a small JSON store under data/,
 * persisted through utils.saveJson (atomic writes + .bak).
 * Recording is best-effort by design — an audit-write failure must never
 * block the admin action itself; it is logged instead.
 */
import path from "path";
import { loadJson, saveJson, getRootDir } from "./utils.js";
import { formatDatetime } from "./time.js";
import { log } from "./logger.js";

const AUDIT_PATH = path.resolve(getRootDir(), "data", "adminAudit.json");

/** Keep the newest N entries — enough for "who restarted the server last
 *  month", bounded so the file can't grow forever. */
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

interface AdminAuditStore {
  entries?: AdminAuditEntry[];
}

export async function loadAdminAudit(): Promise<AdminAuditEntry[]> {
  const data = (await loadJson(AUDIT_PATH)) as AdminAuditStore;
  return Array.isArray(data.entries) ? data.entries : [];
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
    const entries = await loadAdminAudit();
    entries.push({
      at: formatDatetime(),
      action: entry.action,
      server: entry.server ?? null,
      by: entry.by,
      byId: entry.byId,
      guildId: entry.guildId ?? null,
      ...(entry.detail ? { detail: entry.detail } : {}),
    });
    await saveJson(AUDIT_PATH, { entries: entries.slice(-MAX_ENTRIES) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("adminAudit", `Failed to record "${entry.action}": ${msg}`);
  }
}
