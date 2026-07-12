/**
 * One-time import of the legacy JSON stores into SQLite.
 *
 * Runs at every startup (both processes) and is idempotent by
 * construction: each store imports only when its table is empty AND its
 * legacy file exists. The check and the inserts share one IMMEDIATE
 * transaction, so two processes booting at once serialize — the loser
 * finds a non-empty table and skips.
 *
 * After a successful import the source file is renamed to
 * <file>.imported (and its .bak likewise), never deleted: operators can
 * inspect or restore, and a re-run can't double-import. Upgrading is
 * "pull and start", the same contract as every previous on-startup
 * migration in this codebase (snapshot layout, dailyStore v1->v2).
 */
import fs from "fs";
import path from "path";
import type { SqlDatabase } from "./driver.js";
import { mapRow, col } from "./rows.js";
import { getRootDir } from "../utils/utils.js";
import { log } from "../utils/logger.js";
import type {
  LinkCodesMap,
  LinkedAccountsMap,
  WhitelistAuditMap,
} from "../types/index.js";
import type { AdminAuditEntry } from "../utils/adminAudit.js";

// Deliberately NOT the public kv API (db/kv.ts): that module resolves the
// connection through getDb(), and this importer runs INSIDE getDb() before
// the singleton is assigned — importing it would re-enter initialization
// recursively. The importer only ever touches the handle it was given.
function kvGetRaw(db: SqlDatabase, key: string): unknown {
  // rows.ts (mapRow/col) is safe to use here — unlike db/kv.ts it doesn't
  // resolve the connection through getDb(), so there's no re-entrancy.
  const value = mapRow(
    db.prepare("SELECT value FROM kv_store WHERE key = ?"),
    (r) => col.text(r, "value"),
    key,
  );
  return value === null ? null : JSON.parse(value);
}

function kvSetRaw(db: SqlDatabase, key: string, value: unknown): void {
  db.prepare(
    "INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)",
  ).run(key, JSON.stringify(value), new Date().toISOString());
}

function dataPath(file: string): string {
  return path.resolve(getRootDir(), "data", file);
}

/**
 * Read and JSON-parse a legacy data file, or null if absent/corrupt.
 *
 * Returns `unknown`; each caller asserts its file's historical shape (e.g.
 * `as WhitelistAuditMap`). Those casts are deliberate: this is a one-time,
 * best-effort migration of files this app itself wrote in an earlier version,
 * and every consumer defends against missing keys while copying rows into the
 * DB. A malformed file is warned about and skipped rather than trusted.
 */
function readLegacy(file: string): unknown | null {
  const p = dataPath(file);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch (err) {
    // A corrupt legacy file must not brick startup — but it also must
    // not be silently skipped-and-renamed. Leave it in place and warn;
    // the table stays empty until the operator restores or removes it.
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("db", `Legacy ${file} is unreadable (${msg}) — not imported`);
    return null;
  }
}

function retireLegacy(file: string): void {
  for (const name of [file, `${file}.bak`]) {
    const p = dataPath(name);
    try {
      if (fs.existsSync(p)) fs.renameSync(p, `${p}.imported`);
    } catch {
      /* best effort — a failed rename only risks a no-op re-check */
    }
  }
}

function tableEmpty(db: SqlDatabase, table: string): boolean {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {
    n: number;
  };
  return row.n === 0;
}

interface AdminAuditFile {
  entries?: AdminAuditEntry[];
}

export function importLegacyJson(db: SqlDatabase): void {
  // ── adminAudit.json → admin_audit ──
  const adminRaw = readLegacy("adminAudit.json") as AdminAuditFile | null;
  if (adminRaw && Array.isArray(adminRaw.entries)) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "admin_audit")) {
        const ins = db.prepare(
          `INSERT INTO admin_audit (at, action, server, by_tag, by_id, guild_id, detail)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        );
        for (const e of adminRaw.entries) {
          ins.run(
            e.at ?? "",
            e.action ?? "",
            e.server ?? null,
            e.by ?? "",
            e.byId ?? "",
            e.guildId ?? null,
            e.detail ?? null,
          );
        }
        log.info("db", `Imported ${adminRaw.entries.length} adminAudit entries`);
      }
      db.exec("COMMIT");
      retireLegacy("adminAudit.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── whitelistAudit.json → whitelist_audit ──
  const wlRaw = readLegacy("whitelistAudit.json") as WhitelistAuditMap | null;
  if (wlRaw && typeof wlRaw === "object") {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "whitelist_audit")) {
        const ins = db.prepare(
          `INSERT INTO whitelist_audit
             (username_lower, username, uuid, added_by, added_by_id, added_at,
              server, removed_by, removed_by_id, removed_at, removed_from_server)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        );
        let n = 0;
        for (const [key, e] of Object.entries(wlRaw)) {
          if (!e || typeof e !== "object") continue;
          ins.run(
            key.toLowerCase(),
            e.username ?? null,
            e.uuid ?? null,
            e.addedBy ?? null,
            e.addedById ?? null,
            e.addedAt ?? null,
            e.server ?? null,
            e.removedBy ?? null,
            e.removedById ?? null,
            e.removedAt ?? null,
            e.removedFromServer ?? null,
          );
          n++;
        }
        log.info("db", `Imported ${n} whitelistAudit entries`);
      }
      db.exec("COMMIT");
      retireLegacy("whitelistAudit.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── linkedAccounts.json → linked_accounts ──
  const linksRaw = readLegacy("linkedAccounts.json") as LinkedAccountsMap | null;
  if (linksRaw && typeof linksRaw === "object") {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "linked_accounts")) {
        const ins = db.prepare(
          "INSERT INTO linked_accounts (discord_id, mc_name) VALUES (?, ?)",
        );
        let n = 0;
        for (const [discordId, mcName] of Object.entries(linksRaw)) {
          if (typeof mcName !== "string") continue;
          ins.run(discordId, mcName);
          n++;
        }
        log.info("db", `Imported ${n} linked accounts`);
      }
      db.exec("COMMIT");
      retireLegacy("linkedAccounts.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── linkCodes.json → link_codes (skip already-expired codes) ──
  const codesRaw = readLegacy("linkCodes.json") as LinkCodesMap | null;
  if (codesRaw && typeof codesRaw === "object") {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "link_codes")) {
        const ins = db.prepare(
          "INSERT INTO link_codes (code, discord_id, expires, confirmed) VALUES (?, ?, ?, ?)",
        );
        const now = Date.now();
        for (const [code, entry] of Object.entries(codesRaw)) {
          if (!entry || typeof entry !== "object") continue;
          if (typeof entry.expires !== "number" || entry.expires <= now) continue;
          ins.run(code, entry.discordId, entry.expires, entry.confirmed ? 1 : 0);
        }
      }
      db.exec("COMMIT");
      retireLegacy("linkCodes.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── Versioned-blob stores → kv_store (key = filename stem) ──
  //
  // The parsed document is stored verbatim; every loader still runs its
  // own isV1Store/isV2Store validation on read, so a malformed legacy
  // blob degrades exactly as it did from disk.
  const KV_IMPORTS: string[] = [
    "watches",
    "playerNotes",
    "waypoints",
    "sessions",
    "challenges",
    "polls",
    "claimedDaily",
    "pendingRewards",
    "statusMessages",
    "leaderboardSchedule",
    "updateNotifier",
    "consoleRelay",
    "milestones",
    "whitelistApplications",
  ];
  for (const key of KV_IMPORTS) {
    const file = `${key}.json`;
    const raw = readLegacy(file);
    if (raw === null || typeof raw !== "object") continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (kvGetRaw(db, key) === null) {
        kvSetRaw(db, key, raw);
        log.info("db", `Imported ${file} into kv_store["${key}"]`);
      }
      db.exec("COMMIT");
      retireLegacy(file);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── uptimeHistory.json → uptime_checks ──
  const uptimeRaw = readLegacy("uptimeHistory.json") as Record<
    string,
    Array<{ t?: number; up?: number }>
  > | null;
  if (uptimeRaw && typeof uptimeRaw === "object") {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "uptime_checks")) {
        const ins = db.prepare(
          "INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)",
        );
        let n = 0;
        for (const [serverId, entries] of Object.entries(uptimeRaw)) {
          if (!Array.isArray(entries)) continue;
          for (const e of entries) {
            if (typeof e?.t !== "number") continue;
            ins.run(serverId, e.t, e.up ? 1 : 0);
            n++;
          }
        }
        log.info("db", `Imported ${n} uptime checks`);
      }
      db.exec("COMMIT");
      retireLegacy("uptimeHistory.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── playerCounts.json → player_count_hours ──
  const countsRaw = readLegacy("playerCounts.json") as {
    servers?: Record<
      string,
      Array<{ h?: number; sum?: number; max?: number; samples?: number }>
    >;
  } | null;
  if (countsRaw && typeof countsRaw === "object" && countsRaw.servers) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (tableEmpty(db, "player_count_hours")) {
        const ins = db.prepare(
          `INSERT OR IGNORE INTO player_count_hours
             (server_id, h, sum, max, samples) VALUES (?, ?, ?, ?, ?)`,
        );
        let n = 0;
        for (const [serverId, buckets] of Object.entries(countsRaw.servers)) {
          if (!Array.isArray(buckets)) continue;
          for (const b of buckets) {
            if (typeof b?.h !== "number") continue;
            ins.run(serverId, b.h, b.sum ?? 0, b.max ?? 0, b.samples ?? 0);
            n++;
          }
        }
        log.info("db", `Imported ${n} player-count hour buckets`);
      }
      db.exec("COMMIT");
      retireLegacy("playerCounts.json");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}
