/**
 * Config rollback history.
 *
 * Every dashboard config write snapshots the config it REPLACED (via
 * writeConfig), so an operator can revert a change from the dashboard. Kept
 * space-efficient and bounded:
 *   - gzip-compressed JSON in a BLOB (a few-KB config compresses to ~1 KB),
 *   - retained only for RETENTION_DAYS, pruned on every write.
 * ts is epoch-ms (timezone-independent pruning); `at` is the display string.
 */
import zlib from "zlib";
import { getDb, withTransaction } from "../db/index.js";
import { mapRows, col } from "../db/rows.js";
import { formatDatetime } from "./time.js";
import { log } from "./logger.js";

export const RETENTION_DAYS = 3;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

export interface ConfigHistoryEntry {
  id: number;
  /** Epoch ms of the change this snapshot precedes. */
  ts: number;
  /** Display timestamp. */
  at: string;
  byTag: string | null;
  byId: string | null;
  note: string | null;
}

export interface SnapshotMeta {
  byTag?: string | null;
  byId?: string | null;
  note?: string | null;
}

/**
 * Record a config JSON string into rollback history (compressed), then prune
 * anything older than the retention window. Best-effort: a history failure
 * must never fail the config write that triggered it.
 */
export function snapshotConfig(configJson: string, meta: SnapshotMeta = {}): void {
  try {
    const gz = zlib.gzipSync(Buffer.from(configJson, "utf-8"));
    const now = Date.now();
    withTransaction(() => {
      const db = getDb();
      db.prepare(
        `INSERT INTO config_history (ts, at, by_tag, by_id, note, config_gz)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        now,
        formatDatetime(now),
        meta.byTag ?? null,
        meta.byId ?? null,
        meta.note ?? null,
        gz,
      );
      db.prepare(`DELETE FROM config_history WHERE ts < ?`).run(
        now - RETENTION_MS,
      );
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("configHistory", `Failed to snapshot config: ${msg}`);
  }
}

/** History entries (metadata only, no payload), newest first. */
export function listConfigHistory(): ConfigHistoryEntry[] {
  return mapRows(
    getDb().prepare(
      `SELECT id, ts, at, by_tag, by_id, note FROM config_history ORDER BY id DESC`,
    ),
    (r) => ({
      id: col.int(r, "id"),
      ts: col.int(r, "ts"),
      at: col.text(r, "at"),
      byTag: col.textOrNull(r, "by_tag"),
      byId: col.textOrNull(r, "by_id"),
      note: col.textOrNull(r, "note"),
    }),
  );
}

/** The decompressed config JSON for a snapshot id, or null if it's gone. */
export function getConfigSnapshot(id: number): string | null {
  const row = getDb()
    .prepare(`SELECT config_gz FROM config_history WHERE id = ?`)
    .get(id) as { config_gz: Buffer | Uint8Array } | undefined;
  if (!row) return null;
  return zlib.gunzipSync(Buffer.from(row.config_gz)).toString("utf-8");
}
