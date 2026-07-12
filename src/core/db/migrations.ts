/**
 * Schema migrations — ordered, embedded SQL, applied inside transactions
 * and tracked in schema_migrations. Embedded (not .sql files) so tsc's
 * dist/ is self-contained with no asset-copy step.
 *
 * Rules:
 *   - Append only. Never edit a shipped migration; add a new one.
 *   - Each entry must be safe to apply exactly once, in order, on any
 *     database that has applied all previous entries.
 *
 * Both processes run this at startup. The runner takes the write lock
 * (BEGIN IMMEDIATE) around the whole check-and-apply, so two processes
 * booting simultaneously serialize: the second sees the rows the first
 * recorded and applies nothing.
 */
import type { SqlDatabase } from "./driver.js";
import { mapRows, col } from "./rows.js";
import { log } from "../utils/logger.js";

interface Migration {
  id: number;
  name: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "initial: audit logs + account links",
    sql: `
      -- Admin-action audit. Both processes write here — the reason this
      -- table exists (the JSON file lost entries to cross-process races).
      CREATE TABLE admin_audit (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        at       TEXT NOT NULL,
        action   TEXT NOT NULL,
        server   TEXT,
        by_tag   TEXT NOT NULL,
        by_id    TEXT NOT NULL,
        guild_id TEXT,
        detail   TEXT
      );

      -- Whitelist audit trail, keyed by lowercased username (the JSON
      -- store's map key), latest add/remove per player.
      CREATE TABLE whitelist_audit (
        username_lower      TEXT PRIMARY KEY,
        username            TEXT,
        uuid                TEXT,
        added_by            TEXT,
        added_by_id         TEXT,
        added_at            TEXT,
        server              TEXT,
        removed_by          TEXT,
        removed_by_id       TEXT,
        removed_at          TEXT,
        removed_from_server TEXT
      );

      -- Discord <-> Minecraft account links.
      CREATE TABLE linked_accounts (
        discord_id TEXT PRIMARY KEY,
        mc_name    TEXT NOT NULL
      );
      -- Case-insensitive lookup for the "name already owned" rule.
      -- Deliberately not UNIQUE: legacy imports must never fail on
      -- historical duplicates; the store enforces the rule on new links.
      CREATE INDEX idx_linked_accounts_mc_name
        ON linked_accounts (mc_name COLLATE NOCASE);

      -- Pending /link codes (5-minute expiry, confirmed flag kept for
      -- the "already linked just now" reply window).
      CREATE TABLE link_codes (
        code       TEXT PRIMARY KEY,
        discord_id TEXT NOT NULL,
        expires    INTEGER NOT NULL,
        confirmed  INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_link_codes_discord ON link_codes (discord_id);
    `,
  },
  {
    id: 2,
    name: "machine-written stores: kv blobs + time series + snapshots",
    sql: `
      -- Versioned-blob stores (watches, notes, waypoints, sessions,
      -- challenges, polls, daily claims, pending rewards, and the bot's
      -- small watcher states). Keys are the legacy filename stems.
      CREATE TABLE kv_store (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- Downtime-monitor checks, one row per poll. Replaces rewriting a
      -- 43k-entry JSON array on every flush with a single INSERT.
      CREATE TABLE uptime_checks (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id TEXT NOT NULL,
        t         INTEGER NOT NULL,
        up        INTEGER NOT NULL
      );
      CREATE INDEX idx_uptime_server_t ON uptime_checks (server_id, t);

      -- Player-count hour buckets; recording is one atomic UPSERT.
      CREATE TABLE player_count_hours (
        server_id TEXT NOT NULL,
        h         INTEGER NOT NULL,
        sum       INTEGER NOT NULL,
        max       INTEGER NOT NULL,
        samples   INTEGER NOT NULL,
        PRIMARY KEY (server_id, h)
      );

      -- Hourly stat snapshots. The (server_id, ts) key is exactly what
      -- the old per-server directories encoded in paths — and what the
      -- original flat files famously got wrong across servers.
      CREATE TABLE snapshots (
        server_id TEXT NOT NULL,
        ts        INTEGER NOT NULL,
        payload   TEXT NOT NULL,
        PRIMARY KEY (server_id, ts)
      );
    `,
  },
  {
    id: 3,
    name: "config rollback history",
    sql: `
      -- Compact history of config states for dashboard rollback. Each row is
      -- the config as it was BEFORE a write replaced it (gzip-compressed), so
      -- reverting a row restores the config to just before that change. Kept
      -- to a short time window (see configHistory.ts) — ts is epoch ms for
      -- timezone-independent pruning; at is the display string.
      CREATE TABLE config_history (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        ts        INTEGER NOT NULL,
        at        TEXT NOT NULL,
        by_tag    TEXT,
        by_id     TEXT,
        note      TEXT,
        config_gz BLOB NOT NULL
      );
      CREATE INDEX config_history_ts ON config_history (ts);
    `,
  },
];

export function runMigrations(db: SqlDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);

  db.exec("BEGIN IMMEDIATE");
  try {
    const applied = new Set(
      mapRows(
        db.prepare("SELECT id FROM schema_migrations"),
        (row) => col.int(row, "id"),
      ),
    );

    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue;
      db.exec(m.sql);
      db.prepare(
        "INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
      ).run(m.id, m.name, new Date().toISOString());
      log.info("db", `Applied migration ${m.id}: ${m.name}`);
    }
    db.exec("COMMIT");
  } catch (err) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* nothing to roll back */
    }
    throw err;
  }
}
