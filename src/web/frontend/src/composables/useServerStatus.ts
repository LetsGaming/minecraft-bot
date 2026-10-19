import { computed } from "vue";
import { apiGet } from "../api";
import type { StatusResponse } from "../api";
import { useLoader } from "./useLoader";

/**
 * Server-status fetch as a composable. A factory (not a singleton): each
 * caller gets its own reactive state, so views can poll independently.
 * `botAlive` is null until the first answer, so a request that has not
 * answered is never reported as a healthy or a dead bot.
 */
export function useServerStatus() {
  const loader = useLoader(() => apiGet<StatusResponse>("/api/status"), { keepDataOnError: true });
  const servers = computed(() => loader.data.value?.servers ?? []);
  const botAlive = computed<boolean | null>(() => loader.data.value?.bot.alive ?? null);

  async function refresh(): Promise<StatusResponse | null> {
    const ok = await loader.load();
    return ok ? loader.data.value : null;
  }

  return {
    servers,
    botAlive,
    loading: loader.loading,
    loaded: loader.loaded,
    error: loader.error,
    failure: loader.failure,
    refresh,
  };
}
