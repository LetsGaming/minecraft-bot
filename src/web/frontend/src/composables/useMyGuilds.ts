import { computed } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { useToast } from "primevue/usetoast";
import { apiGet } from "../api";
import { useLoader } from "./useLoader";

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
  const loader = useLoader(
    async () => (await apiGet<{ guilds: MyGuildRow[] }>("/api/guilds")).guilds,
    { keepDataOnError: true },
  );
  const guilds = computed<MyGuildRow[]>(() => loader.data.value ?? []);
  /** True until the first answer, so a view shows its spinner rather than an empty list. */
  const loading = computed(() => loader.loading.value || !loader.loaded.value);

  /** `silent` skips the toast, for views that show `error` inline or not at all. */
  async function load(silent = false): Promise<void> {
    const ok = await loader.load();
    if (!ok && !silent && loader.error.value) {
      toast.add({
        severity: "error",
        summary: "Failed to load guilds",
        detail: errorMessage(loader.error.value),
        life: 4000,
      });
    }
  }

  return { guilds, loading, loaded: loader.loaded, error: loader.error, cause: loader.cause, failure: loader.failure, load };
}
