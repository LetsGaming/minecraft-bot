import { computed } from "vue";
import { apiGet } from "../api";
import type { AuditEntry } from "../api";
import { useLoader } from "./useLoader";

/**
 * Loads the admin audit feed. Shared by the full Audit view (large limit) and
 * the Overview's recent-activity panel (small limit). Both show a failure in
 * place of the list, so a failed read never looks like an empty log.
 */
export function useAudit() {
  const loader = useLoader(
    async (limit: number) => (await apiGet<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`)).entries,
    { keepDataOnError: true },
  );
  const entries = computed<AuditEntry[]>(() => loader.data.value ?? []);

  async function load(limit = 200): Promise<void> {
    await loader.load(limit);
  }

  return {
    entries,
    loading: loader.loading,
    loaded: loader.loaded,
    error: loader.error,
    failure: loader.failure,
    load,
  };
}
