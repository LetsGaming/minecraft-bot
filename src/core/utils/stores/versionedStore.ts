/**
 * The shared shape of the whole-document stores kept in kv_store: a small
 * `{ version, <container> }` document that is loaded whole and changed by
 * pure helpers inside one transaction.
 *
 * `versionedStore` owns the key, the shape check and the fallback to an empty
 * document, so a store file only declares its types and its helpers. Changes
 * go through `update` (never load, await, save): the callback sees the row as
 * it is inside the write lock, so concurrent writers cannot lose each other.
 */
import { kvGet, kvMutate, kvSet } from "../../db/kv.js";

export interface VersionedShape {
  version: number;
  /** The property holding the payload (`servers`, `watches`, …). */
  container: string;
  /** What the container must be. Defaults to a plain object. */
  kind?: "object" | "array";
}

/** True when `raw` is a document of this version whose container has the expected kind. */
export function isVersionedDoc<S>(raw: unknown, shape: VersionedShape): raw is S {
  if (typeof raw !== "object" || raw === null) return false;
  const doc = raw as Record<string, unknown>;
  if (doc["version"] !== shape.version) return false;
  const container = doc[shape.container];
  return shape.kind === "array"
    ? Array.isArray(container)
    : typeof container === "object" && container !== null && !Array.isArray(container);
}

export interface DocumentStore<S> {
  /** The stored document, or an empty one when unset or malformed. */
  load(): S;
  /** Read-modify-write inside one transaction; returns what `fn` returns. */
  update<T>(fn: (store: S) => T): T;
  /** Replace the whole document. Only for stores that cannot lose updates (single writer). */
  save(store: S): void;
  /** The normaliser, for code that combines several keys in one transaction. */
  normalize(raw: unknown): S;
}

/**
 * A store whose row has no version envelope (a bare map or a loose
 * object). `normalize` turns whatever is stored, or null, into the typed
 * document.
 */
export function documentStore<S>(
  key: string,
  normalize: (raw: unknown) => S,
): DocumentStore<S> {
  return {
    load: () => normalize(kvGet<unknown>(key)),
    update: (fn) => kvMutate(key, normalize, fn),
    save: (store) => kvSet(key, store),
    normalize,
  };
}

/**
 * @param revive Runs on every document read, to restore invariants JSON loses
 *   (for example null-prototype maps for player-name keys).
 */
export function versionedStore<S>(
  key: string,
  shape: VersionedShape,
  empty: () => S,
  revive: (store: S) => S = (store) => store,
): DocumentStore<S> {
  return documentStore(key, (raw) =>
    revive(isVersionedDoc<S>(raw, shape) ? raw : empty()),
  );
}
