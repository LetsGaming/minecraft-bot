/**
 * Checked blob accessors for query rows, next to the `col` text and number
 * accessors in `db/rows.ts`. A blob column comes back from either SQLite
 * driver as a `Uint8Array` (a `Buffer` is one), and anything else means the
 * schema and the mapper have drifted.
 */

type Row = Record<string, unknown>;

function fail(column: string, got: unknown): never {
  throw new Error(
    `Unexpected DB value for column "${column}": expected a blob, got ` +
      `${got === null ? "null" : typeof got}. The schema and the row mapper have drifted.`,
  );
}

/** A NOT NULL blob column. */
export function blob(row: Row, column: string): Uint8Array {
  const v = row[column];
  return v instanceof Uint8Array ? v : fail(column, v);
}

/** A nullable blob column. */
export function blobOrNull(row: Row, column: string): Uint8Array | null {
  const v = row[column];
  if (v === null) return null;
  return v instanceof Uint8Array ? v : fail(column, v);
}
