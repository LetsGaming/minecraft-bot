import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
import { apiGet } from "../api";
import type { StatusResponse, ServerStatus } from "../api";

// Server-status fetch as a composable. A factory (not a singleton): each
// caller gets its own reactive state, so views can poll independently.
// Centralises the endpoint + shape so the fetch isn't re-implemented.
export function useServerStatus() {
  const servers = ref<ServerStatus[]>([]);
  const botAlive = ref(true);
  const loading = ref(false);
  /** False until the first answer, success or failure, has arrived. */
  const loaded = ref(false);
  const error = ref("");
  const failure = ref<LoadFailure | null>(null);

  async function refresh(): Promise<StatusResponse | null> {
    loading.value = true;
    error.value = "";
    failure.value = null;
    try {
      const res = await apiGet<StatusResponse>("/api/status");
      servers.value = res.servers;
      botAlive.value = res.bot.alive;
      return res;
    } catch (err) {
      error.value = errorMessage(err);
      failure.value = loadFailure(err);
      return null;
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  return { servers, botAlive, loading, loaded, error, failure, refresh };
}
