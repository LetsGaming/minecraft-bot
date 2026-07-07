import { ref } from "vue";
import { apiGet } from "../api";
import type { StatusResponse, ServerStatus } from "../api";

// Server-status fetch as a composable. A factory (not a singleton): each
// caller gets its own reactive state, so views can poll independently.
// Centralises the endpoint + shape so the fetch isn't re-implemented.
export function useServerStatus() {
  const servers = ref<ServerStatus[]>([]);
  const botAlive = ref(true);
  const loading = ref(false);
  const error = ref("");

  async function refresh(): Promise<StatusResponse | null> {
    loading.value = true;
    error.value = "";
    try {
      const res = await apiGet<StatusResponse>("/api/status");
      servers.value = res.servers;
      botAlive.value = res.bot.alive;
      return res;
    } catch (err) {
      error.value = (err as Error).message;
      return null;
    } finally {
      loading.value = false;
    }
  }

  return { servers, botAlive, loading, error, refresh };
}
