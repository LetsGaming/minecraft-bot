import { ref, shallowRef } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { useToast } from "primevue/usetoast";
import { apiGet } from "../api";

export interface MyGuildRow {
  id: string;
  configured: boolean;
  features: string[];
}

/**
 * The guilds the current user may configure (from the scoped /api/guilds),
 * each flagged configured with its enabled features. Distinct from
 * useGuilds, which resolves guild *names* for display; this is the
 * authorization-scoped list of what the user can act on.
 */
export function useMyGuilds() {
  const toast = useToast();
  const guilds = ref<MyGuildRow[]>([]);
  const loading = ref(true);
  /** The last load's failure, kept so a view can say why in place; null after a good load. */
  const error = shallowRef<unknown>(null);

  /** `silent` skips the toast, for views that show `error` inline or not at all. */
  async function load(silent = false): Promise<void> {
    loading.value = true;
    try {
      const res = await apiGet<{ guilds: MyGuildRow[] }>("/api/guilds");
      guilds.value = res.guilds;
      error.value = null;
    } catch (err) {
      error.value = err;
      if (!silent) {
        toast.add({
          severity: "error",
          summary: "Failed to load guilds",
          detail: errorMessage(err),
          life: 4000,
        });
      }
    } finally {
      loading.value = false;
    }
  }

  return { guilds, loading, error, load };
}
