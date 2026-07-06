/**
 * Generic JSON-blob storage in SQLite (kv_store table) — the home of the
 * versioned-blob stores (watches, notes, waypoints, sessions, polls, …).
 *
 * These stores share one shape: a small typed document loaded whole,
 * mutated by pure helpers, saved whole. That pattern survives unchanged;
 * only the medium moves — and gains what the JSON files never had:
 * kvUpdate() makes the whole read-modify-write one IMMEDIATE transaction,
 * atomic within and across processes.
 *
 * Keys are the legacy filename stems ("watches", "claimedDaily", …), so
 * the mapping from old file to new row is self-evident when inspecting
 * data/bot.db.
 */
import { getDb, withTransaction } from "./index.js";

export function kvGet<T>(key: string): T | null {
  const row = getDb()
    .prepare("SELECT value FROM kv_store WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return null;
  return JSON.parse(row.value) as T;
}

export function kvSet(key: string, value: unknown): void {
  getDb()
    .prepare(
      `INSERT INTO kv_store (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

/** Atomic read-modify-write: fn sees the current value (null when unset)
 *  and returns the next one; the whole cycle holds the write lock. */
export function kvUpdate<T>(key: string, fn: (current: T | null) => T): T {
  return withTransaction(() => {
    const next = fn(kvGet<T>(key));
    kvSet(key, next);
    return next;
  });
}

export function kvDelete(key: string): void {
  getDb().prepare("DELETE FROM kv_store WHERE key = ?").run(key);
}
