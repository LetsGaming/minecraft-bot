/**
 * Row mapping — the one place query results become typed values.
 *
 * The project runs `strict` + `noUncheckedIndexedAccess`, then every store
 * used to throw that guarantee away at the storage edge with
 * `.all() as unknown as Row[]`: a renamed or dropped column still compiled and
 * only surfaced as `undefined` at runtime (QUAL-01, 2026-07 audit;
 * data-persistence.md's "highest-value type rule"). Route every read through
 * `mapRows`/`mapRow` with an explicit per-column mapper instead, and select
 * explicit columns rather than `SELECT *`.
 *
 * The `col` accessors read a named column as a specific type and throw loudly
 * on drift — a mismatch names the column instead of silently producing bad
 * data. SQLite is dynamically typed and both drivers return plain JS values
 * (strings, numbers, and — for large integers — bigints), so the checks are a
 * real guard, not ceremony.
 */
import type { SqlStatement } from "./driver.js";

type Row = Record<string, unknown>;

/** Run a multi-row query and map each row — never `.all() as Row[]`. */
export function mapRows<T>(
  stmt: SqlStatement,
  map: (row: Row) => T,
  ...params: unknown[]
): T[] {
  return (stmt.all(...params) as Row[]).map(map);
}

/** Run a single-row query; returns null when the row is absent. */
export function mapRow<T>(
  stmt: SqlStatement,
  map: (row: Row) => T,
  ...params: unknown[]
): T | null {
  const row = stmt.get(...params) as Row | undefined;
  return row ? map(row) : null;
}

function fail(column: string, want: string, got: unknown): never {
  throw new Error(
    `Unexpected DB value for column "${column}": expected ${want}, ` +
      `got ${got === null ? "null" : typeof got}. The schema and the row ` +
      `mapper have drifted — check the migration and the SELECT.`,
  );
}

/** Checked column accessors — each throws (naming the column) on type drift. */
export const col = {
  /** A NOT NULL text column. */
  text(row: Row, column: string): string {
    const v = row[column];
    return typeof v === "string" ? v : fail(column, "string", v);
  },
  /** A nullable text column. */
  textOrNull(row: Row, column: string): string | null {
    const v = row[column];
    if (v === null) return null;
    return typeof v === "string" ? v : fail(column, "string | null", v);
  },
  /** A NOT NULL integer/real column (bigints are narrowed to number). */
  int(row: Row, column: string): number {
    const v = row[column];
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    return fail(column, "number", v);
  },
  /** A nullable integer/real column. */
  intOrNull(row: Row, column: string): number | null {
    const v = row[column];
    if (v === null) return null;
    if (typeof v === "number") return v;
    if (typeof v === "bigint") return Number(v);
    return fail(column, "number | null", v);
  },
  /** A boolean stored as integer 0/1 (SQLite has no boolean type). */
  bool(row: Row, column: string): boolean {
    const v = row[column];
    if (v === 0 || v === 1) return v === 1;
    return fail(column, "0 or 1", v);
  },
  /** A JSON document stored in a text column. */
  json<T>(row: Row, column: string): T {
    return JSON.parse(col.text(row, column)) as T;
  },
};
