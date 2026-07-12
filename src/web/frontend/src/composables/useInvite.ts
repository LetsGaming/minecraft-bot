import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { useToast } from "primevue/usetoast";
import { apiGet } from "../api";
import type { InviteResponse } from "../api";

/**
 * "Add to Server": fetch the server-built Discord invite URL and open it.
 * Shared by the sidebar CTA and the Guilds view so the fetch + error
 * handling live in one place.
 */
export function useInvite() {
  const toast = useToast();
  const inviting = ref(false);

  async function invite(): Promise<void> {
    inviting.value = true;
    try {
      const res = await apiGet<InviteResponse>("/api/invite");
      window.open(res.url, "_blank", "noopener");
    } catch (err) {
      toast.add({
        severity: "error",
        summary: "Invite failed",
        detail: errorMessage(err),
        life: 4000,
      });
    } finally {
      inviting.value = false;
    }
  }

  return { inviting, invite };
}
