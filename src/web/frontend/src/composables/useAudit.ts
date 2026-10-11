import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
import { apiGet } from "../api";
import type { AuditEntry } from "../api";

/**
 * Loads the admin audit feed. Shared by the full Audit view (large limit) and
 * the Overview's recent-activity panel (small limit). Both show a failure in
 * place of the list, so a failed read never looks like an empty log.
 */
export function useAudit() {
  const entries = ref<AuditEntry[]>([]);
  const loading = ref(false);
  /** False until the first answer, success or failure, has arrived. */
  const loaded = ref(false);
  const error = ref("");
  const failure = ref<LoadFailure | null>(null);

  async function load(limit = 200): Promise<void> {
    loading.value = true;
    error.value = "";
    failure.value = null;
    try {
      const res = await apiGet<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`);
      entries.value = res.entries;
    } catch (err) {
      error.value = errorMessage(err);
      failure.value = loadFailure(err);
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  return { entries, loading, loaded, error, failure, load };
}
