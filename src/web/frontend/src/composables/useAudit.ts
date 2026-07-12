import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { useToast } from "primevue/usetoast";
import { apiGet } from "../api";
import type { AuditEntry } from "../api";

/**
 * Loads the admin audit feed. Shared by the full Audit view (large limit,
 * surfaces errors) and the Overview's recent-activity panel (small limit,
 * silent — a secondary panel shouldn't pop error toasts).
 */
export function useAudit() {
  const toast = useToast();
  const entries = ref<AuditEntry[]>([]);

  async function load(limit = 200, silent = false): Promise<void> {
    try {
      const res = await apiGet<{ entries: AuditEntry[] }>(`/api/audit?limit=${limit}`);
      entries.value = res.entries;
    } catch (err) {
      if (!silent) {
        toast.add({
          severity: "error",
          summary: "Failed to load audit log",
          detail: errorMessage(err),
          life: 4000,
        });
      }
    }
  }

  return { entries, load };
}
