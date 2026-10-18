/**
 * Records keyed by player names or other external strings.
 *
 * A plain object treats `__proto__` and `constructor` as special: reading
 * them returns inherited values and assigning `__proto__` rewrites the
 * prototype. Records created here have no prototype, and `ownGet`/`ownSet`
 * stay correct on plain objects that came out of `JSON.parse` as well.
 */

export function createRecord<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>;
}

/** A null-prototype copy of `source`'s own enumerable entries. */
export function toRecord<V>(source: Record<string, V>): Record<string, V> {
  const out = createRecord<V>();
  for (const key of Object.keys(source)) ownSet(out, key, source[key] as V);
  return out;
}

export function ownGet<V>(record: Record<string, V>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

export function ownSet<V>(record: Record<string, V>, key: string, value: V): void {
  Object.defineProperty(record, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
