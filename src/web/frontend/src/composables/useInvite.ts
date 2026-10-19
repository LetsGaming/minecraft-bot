import { ref } from "vue";
import { useNotify } from "./useNotify";
import { t } from "../i18n";
import { apiGet } from "../api";
import type { InviteResponse } from "../api";

/**
 * "Add to Server": fetch the server-built Discord invite URL and open it.
 * Shared by the sidebar CTA and the Guilds view so the fetch + error
 * handling live in one place.
 */
export function useInvite() {
  const notify = useNotify();
  const inviting = ref(false);

  async function invite(): Promise<void> {
    inviting.value = true;
    try {
      const res = await apiGet<InviteResponse>("/api/invite");
      window.open(res.url, "_blank", "noopener");
    } catch (err) {
      notify.fail(t("invite.failed"), err);
    } finally {
      inviting.value = false;
    }
  }

  return { inviting, invite };
}
