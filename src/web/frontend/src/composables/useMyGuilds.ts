import { ref, shallowRef } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
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
  /** False until the first answer, success or failure, has arrived. */
  const loaded = ref(false);
  /** The last load's failure, kept so a view can say why in place; null after a good load. */
  const error = shallowRef<unknown>(null);
  const failure = ref<LoadFailure | null>(null);

  /** `silent` skips the toast, for views that show `error` inline or not at all. */
  async function load(silent = false): Promise<void> {
    loading.value = true;
    error.value = null;
    failure.value = null;
    try {
      const res = await apiGet<{ guilds: MyGuildRow[] }>("/api/guilds");
      guilds.value = res.guilds;
      error.value = null;
    } catch (err) {
      error.value = err;
      failure.value = loadFailure(err);
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
      loaded.value = true;
    }
  }

  return { guilds, loading, loaded, error, failure, load };
}
