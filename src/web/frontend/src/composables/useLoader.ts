import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";

/**
 * Latest-wins bookkeeping for async work whose results land out of order.
 * `begin()` starts a request and returns a predicate: true only while no newer
 * request has started (or `cancel()` has been called) since.
 */
export function latest(): { begin(): () => boolean; cancel(): void } {
  let generation = 0;
  return {
    begin() {
      const mine = ++generation;
      return () => mine === generation;
    },
    cancel() {
      generation++;
    },
  };
}

export interface Loader<A extends unknown[], T> {
  data: ShallowRef<T | null>;
  /** True while the newest request is in flight. */
  loading: Ref<boolean>;
  /** False until the first answer to the newest request, success or failure. */
  loaded: Ref<boolean>;
  error: Ref<string>;
  failure: Ref<LoadFailure | null>;
  /** The raw thrown value of the last failure, for callers that classify it themselves. */
  cause: ShallowRef<unknown>;
  /** Resolves true when the newest request succeeded; a superseded call resolves false and writes nothing. */
  load(...args: A): Promise<boolean>;
  /** Drop the data and the error and ignore any request still in flight. */
  reset(): void;
}

/**
 * One read with the loading/loaded/error/failure state every fetching
 * composable needs. A response that is no longer the newest request is
 * discarded, so switching the thing being read never shows the old answer.
 * A later call replaces an earlier one in flight rather than waiting behind it.
 */
export function useLoader<A extends unknown[], T>(
  fetcher: (...args: A) => Promise<T>,
  options: { onData?: (data: T) => void; keepDataOnError?: boolean } = {},
): Loader<A, T> {
  const data = shallowRef<T | null>(null);
  const loading = ref(false);
  const loaded = ref(false);
  const error = ref("");
  const failure = ref<LoadFailure | null>(null);
  const cause = shallowRef<unknown>(null);
  const guard = latest();

  async function load(...args: A): Promise<boolean> {
    const current = guard.begin();
    loading.value = true;
    error.value = "";
    failure.value = null;
    cause.value = null;
    try {
      const result = await fetcher(...args);
      if (!current()) return false;
      data.value = result;
      options.onData?.(result);
      return true;
    } catch (err) {
      if (!current()) return false;
      if (!options.keepDataOnError) data.value = null;
      error.value = errorMessage(err);
      failure.value = loadFailure(err);
      cause.value = err;
      return false;
    } finally {
      if (current()) {
        loading.value = false;
        loaded.value = true;
      }
    }
  }

  function reset(): void {
    guard.cancel();
    data.value = null;
    loading.value = false;
    loaded.value = false;
    error.value = "";
    failure.value = null;
    cause.value = null;
  }

  return { data, loading, loaded, error, failure, cause, load, reset };
}
