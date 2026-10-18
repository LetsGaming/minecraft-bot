import { computed, ref, shallowRef, type Ref } from "vue";
import { isConflict, validationErrors } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { registerDirtySource } from "./useUnsavedGuard";
import { latest } from "./useLoader";

/** A queued or drafted edit whose key moved on the server while it waited. */
export interface EditConflict {
  keyPath: string[];
  queued: unknown;
  base: unknown;
  current: unknown;
  queuedAt: number;
  byTag: string | null;
  /** Which file it belongs to. Present on preview results. */
  fileId?: string;
}

/**
 * Editing one server-held JSON document without losing anyone's work.
 *
 * The behaviour every admin editor needs, in one place:
 *
 *  - a draft that is edited freely, compared against the baseline last read
 *    from the server, with a dirty flag per field ("unit"),
 *  - a save that sends only what changed, guarded by the token that came with
 *    the LOAD. The token is never refetched at save time: re-reading it right
 *    before the write would make the conflict check always pass,
 *  - a re-read after every save, so the baseline is what the server holds,
 *  - a conflict (HTTP 409) that keeps the user's edits. The latest server
 *    state is merged in field by field; only fields both sides changed are
 *    surfaced, for the user to resolve (keep mine / keep the server's),
 *  - loading, load failure with retry, saving and saved states,
 *  - registration with the unsaved-changes guard (tab close, tab switch).
 */

export interface DocChanges {
  /** Unit key to its new value. */
  set: Record<string, unknown>;
  /** Unit keys that existed in the baseline and were removed from the draft. */
  remove: string[];
}

/**
 * How a document breaks into independently tracked fields. The default is the
 * document's top-level keys; a document whose natural fields are deeper
 * supplies its own.
 */
export interface DocUnits<T> {
  read(doc: T): Record<string, unknown>;
  /** Set a unit on `doc` in place; `undefined` removes it. */
  write(doc: T, key: string, value: unknown): void;
}

export interface LoadedDocument<T, M> {
  doc: T;
  /** The concurrency token that came with this read (hash or ETag). */
  token: string;
  /** Anything else the same read returned (schema, manifest, ...). */
  meta?: M;
}

export interface EditableSource<T, M> {
  load(): Promise<LoadedDocument<T, M>>;
  save(input: {
    token: string;
    draft: T;
    changes: DocChanges;
  }): Promise<{ warnings?: string[] } | void>;
}

export interface EditableOptions<T> {
  units?: DocUnits<T>;
  /** Register with the unsaved-changes guard. Default true. */
  guard?: boolean;
}

const clone = <V>(value: V): V =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as V);

function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : v,
  ) ?? "undefined";
}

export function topLevelUnits<T extends Record<string, unknown>>(): DocUnits<T> {
  return {
    read: (doc) => ({ ...doc }),
    write: (doc, key, value) => {
      if (value === undefined) delete (doc as Record<string, unknown>)[key];
      else (doc as Record<string, unknown>)[key] = value;
    },
  };
}

export function useEditableDocument<T extends object, M = unknown>(
  source: EditableSource<T, M>,
  options: EditableOptions<T> = {},
) {
  const units: DocUnits<T> =
    options.units ?? (topLevelUnits<Record<string, unknown>>() as unknown as DocUnits<T>);

  const baseline = shallowRef<T | null>(null);
  const draft = ref<T | null>(null) as Ref<T | null>;
  const token = ref("");
  const meta = shallowRef<M | undefined>(undefined);

  const loading = ref(false);
  const loadError = ref("");
  const saving = ref(false);
  const savedFlag = ref(false);
  const saveError = ref("");
  const fieldErrors = ref<string[]>([]);
  const warnings = ref<string[]>([]);
  const conflicts = ref<EditConflict[]>([]);
  /**
   * The save went through but the follow-up read did not, so the token is
   * unknown. Saving again is refused until a reload succeeds.
   */
  const stale = ref(false);

  const ready = computed(() => baseline.value !== null && draft.value !== null);

  const dirtyKeys = computed<string[]>(() => {
    if (!baseline.value || !draft.value) return [];
    const before = units.read(baseline.value);
    const after = units.read(draft.value);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...keys].filter((key) => stable(before[key]) !== stable(after[key]));
  });
  const dirty = computed(() => dirtyKeys.value.length > 0);
  const dirtySet = computed(() => new Set(dirtyKeys.value));
  /** True after a successful save, until the next edit. */
  const saved = computed(() => savedFlag.value && !dirty.value);

  const changes = computed<DocChanges>(() => {
    const out: DocChanges = { set: {}, remove: [] };
    if (!draft.value) return out;
    const after = units.read(draft.value);
    for (const key of dirtyKeys.value) {
      if (after[key] === undefined) out.remove.push(key);
      else out.set[key] = clone(after[key]);
    }
    return out;
  });

  function isDirty(key: string): boolean {
    return dirtySet.value.has(key);
  }

  if (options.guard !== false) registerDirtySource(() => dirty.value);

  function adopt(read: LoadedDocument<T, M>): void {
    baseline.value = clone(read.doc);
    draft.value = clone(read.doc);
    token.value = read.token;
    meta.value = read.meta;
    conflicts.value = [];
    stale.value = false;
  }

  const loads = latest();

  /**
   * Read the document. Replaces the draft, so callers confirm first when
   * dirty. Only the newest read is adopted: an older answer that lands late
   * resolves false and changes nothing.
   */
  async function load(): Promise<boolean> {
    const current = loads.begin();
    loading.value = true;
    loadError.value = "";
    try {
      const read = await source.load();
      if (!current()) return false;
      adopt(read);
      return true;
    } catch (err) {
      if (!current()) return false;
      loadError.value = errorMessage(err);
      return false;
    } finally {
      if (current()) loading.value = false;
    }
  }

  /** Forget the document entirely (switching to a different one). */
  function reset(): void {
    loads.cancel();
    loading.value = false;
    baseline.value = null;
    draft.value = null;
    token.value = "";
    meta.value = undefined;
    conflicts.value = [];
    stale.value = false;
    savedFlag.value = false;
    loadError.value = "";
    saveError.value = "";
    fieldErrors.value = [];
    warnings.value = [];
  }

  function setField(key: string, value: unknown): void {
    if (!draft.value) return;
    units.write(draft.value, key, value);
  }

  function discard(): void {
    if (!baseline.value) return;
    draft.value = clone(baseline.value);
    conflicts.value = [];
    saveError.value = "";
    fieldErrors.value = [];
  }

  /**
   * Merge a fresh server read into the draft after a 409. Fields only the
   * server changed are adopted, fields only the user changed stay, and fields
   * both changed to different values become conflicts. The draft is never
   * overwritten for those.
   */
  function mergeRemote(remote: LoadedDocument<T, M>): void {
    const base = baseline.value ? units.read(baseline.value) : {};
    const mine = draft.value ? units.read(draft.value) : {};
    const theirs = units.read(remote.doc);
    const found: EditConflict[] = [];
    const next = clone(draft.value as T);

    for (const key of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
      const theirsChanged = stable(theirs[key]) !== stable(base[key]);
      if (!theirsChanged) continue;
      const mineChanged = stable(mine[key]) !== stable(base[key]);
      if (!mineChanged || stable(mine[key]) === stable(theirs[key])) {
        units.write(next, key, clone(theirs[key]));
      } else {
        found.push({
          keyPath: key.split("."),
          queued: mine[key],
          base: base[key],
          current: theirs[key],
          queuedAt: Date.now(),
          byTag: null,
        });
      }
    }

    draft.value = next;
    baseline.value = clone(remote.doc);
    token.value = remote.token;
    meta.value = remote.meta;
    conflicts.value = found;
  }

  const keyOf = (conflict: EditConflict): string => conflict.keyPath.join(".");

  /** Settle one conflicted field: keep the user's value or take the server's. */
  function resolveConflict(conflict: EditConflict, choice: "queued" | "current"): void {
    if (choice === "current" && draft.value) {
      units.write(draft.value, keyOf(conflict), clone(conflict.current));
    }
    conflicts.value = conflicts.value.filter((c) => keyOf(c) !== keyOf(conflict));
  }

  /** Throw the user's edits away and take what the server has now. */
  async function reloadDiscardingMine(): Promise<boolean> {
    saveError.value = "";
    fieldErrors.value = [];
    return load();
  }

  async function save(): Promise<boolean> {
    if (!ready.value || saving.value) return false;
    if (stale.value) {
      saveError.value = "Reload before saving again: the last save went through but the page could not re-read it.";
      return false;
    }
    if (conflicts.value.length > 0) {
      saveError.value = "Resolve the conflicting fields first.";
      return false;
    }
    if (!dirty.value) return false;

    saving.value = true;
    saveError.value = "";
    fieldErrors.value = [];
    warnings.value = [];
    try {
      const result = await source.save({
        token: token.value,
        draft: clone(draft.value as T),
        changes: changes.value,
      });
      warnings.value = (result && result.warnings) || [];
    } catch (err) {
      if (isConflict(err)) {
        try {
          mergeRemote(await source.load());
          saveError.value =
            conflicts.value.length > 0
              ? "Someone else changed some of the same fields. Your edits are kept; choose which value to keep."
              : "The configuration changed since you loaded it. Your edits were kept on top of the latest version; review and save again.";
        } catch (loadErr) {
          saveError.value = `The configuration changed since you loaded it, and the latest version could not be loaded (${errorMessage(loadErr)}). Your edits are kept.`;
        }
      } else {
        const list = validationErrors(err);
        if (list.length > 0) {
          fieldErrors.value = list;
          saveError.value = "The server rejected the changes.";
        } else {
          saveError.value = errorMessage(err);
        }
      }
      saving.value = false;
      return false;
    }

    try {
      adopt(await source.load());
      savedFlag.value = true;
    } catch (err) {
      // The write landed; only the confirmation read failed.
      baseline.value = clone(draft.value as T);
      stale.value = true;
      savedFlag.value = true;
      loadError.value = errorMessage(err);
    }
    saving.value = false;
    return true;
  }

  return {
    draft, baseline, token, meta,
    ready, loading, loadError, saving, saved, saveError, fieldErrors, warnings, stale,
    dirty, dirtyKeys, changes, isDirty, conflicts,
    load, reset, setField, discard, save, resolveConflict, reloadDiscardingMine,
  };
}
