import { computed, reactive, shallowRef } from "vue";

export interface RowBusyOptions {
  /** What the row is doing, for its busy text ("Deleting"). */
  label?: string;
  /** Locks every other row while this runs (a restore replaces what they point at). */
  exclusive?: boolean;
}

/**
 * Per-row busy state for lists: one row works while the others stay usable,
 * unless the running operation is exclusive.
 */
export function useRowBusy<K extends string | number = string>() {
  const rows = reactive(new Map<K, string>()) as Map<K, string>;
  const exclusiveKey = shallowRef<K | null>(null);

  const anyBusy = computed(() => rows.size > 0);

  function isBusy(key: K): boolean {
    return rows.has(key);
  }

  function busyLabel(key: K): string {
    return rows.get(key) ?? "";
  }

  /** True when the row may not start anything: it is busy, or another row holds the lock. */
  function isLocked(key: K): boolean {
    if (rows.has(key)) return true;
    return exclusiveKey.value !== null && exclusiveKey.value !== key;
  }

  async function run<T>(key: K, task: () => Promise<T>, options: RowBusyOptions = {}): Promise<T> {
    rows.set(key, options.label ?? "");
    if (options.exclusive) exclusiveKey.value = key;
    try {
      return await task();
    } finally {
      rows.delete(key);
      if (exclusiveKey.value === key) exclusiveKey.value = null;
    }
  }

  return {
    anyBusy,
    exclusiveKey,
    isBusy,
    busyLabel,
    isLocked,
    run,
  };
}
