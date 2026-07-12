import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import { apiGet, apiSend } from "../api";

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Server operations for the Servers view: run an action (start / stop /
 * restart / backup) with a confirm step for the destructive ones, and
 * toggle a tail of the server log. Owns its own toast + confirm so the
 * view just calls the methods. `refresh` is invoked after a successful
 * action so the caller can re-pull status (and emit it onward).
 */
export function useServerActions(refresh: () => Promise<unknown>) {
  const toast = useToast();
  const confirm = useConfirm();

  const busy = ref("");
  const logServer = ref("");
  const logLines = ref<string[]>([]);

  async function runAction(serverId: string, action: string): Promise<void> {
    if (action === "stop" || action === "restart") {
      const ok = await new Promise<boolean>((resolve) => {
        confirm.require({
          message: `Really ${action} "${serverId}"?`,
          header: `Confirm ${action}`,
          icon: "pi pi-exclamation-triangle",
          acceptLabel: capitalize(action),
          rejectLabel: "Cancel",
          acceptClass: action === "stop" ? "p-button-danger" : "",
          accept: () => resolve(true),
          reject: () => resolve(false),
          onHide: () => resolve(false),
        });
      });
      if (!ok) return;
    }
    busy.value = serverId;
    try {
      const res = await apiSend<{ ok: boolean; exitCode: number | null }>(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}/${action}`,
      );
      toast.add({
        severity: res.ok ? "success" : "warn",
        summary: `${capitalize(action)} · ${serverId}`,
        detail: res.ok ? "Done" : `Exit code ${res.exitCode}`,
        life: 3000,
      });
      await refresh();
    } catch (err) {
      toast.add({
        severity: "error",
        summary: `${capitalize(action)} failed`,
        detail: errorMessage(err),
        life: 4000,
      });
    } finally {
      busy.value = "";
    }
  }

  async function toggleLog(serverId: string): Promise<void> {
    if (logServer.value === serverId) {
      logServer.value = "";
      logLines.value = [];
      return;
    }
    try {
      const res = await apiGet<{ lines: string[] }>(
        `/api/servers/${encodeURIComponent(serverId)}/log?lines=50`,
      );
      logServer.value = serverId;
      logLines.value = res.lines;
    } catch (err) {
      toast.add({
        severity: "error",
        summary: "Log tail failed",
        detail: errorMessage(err),
        life: 4000,
      });
    }
  }

  return { busy, logServer, logLines, runAction, toggleLog };
}
