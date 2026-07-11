import { ref } from "vue";
import { useToast } from "primevue/usetoast";
import { useConfirm } from "primevue/useconfirm";
import { apiGet, apiSend } from "../api";

export interface ConfigHistoryEntry {
  id: number;
  at: string;
  by: string | null;
  note: string | null;
}

/**
 * Config rollback history + the rollback action. Each entry is the config as
 * it was BEFORE a change (kept a few days), so restoring one reverts to just
 * before that change. Rolling back is itself snapshotted, so it's reversible —
 * the confirm dialog says as much.
 */
export function useConfigHistory() {
  const toast = useToast();
  const confirm = useConfirm();

  const entries = ref<ConfigHistoryEntry[]>([]);
  const retentionDays = ref(3);
  const loading = ref(false);
  const busyId = ref<number | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    try {
      const res = await apiGet<{
        retentionDays: number;
        entries: ConfigHistoryEntry[];
      }>("/api/config/history");
      entries.value = res.entries;
      retentionDays.value = res.retentionDays;
    } catch {
      entries.value = [];
    } finally {
      loading.value = false;
    }
  }

  function confirmRollback(entry: ConfigHistoryEntry): void {
    confirm.require({
      message:
        `Restore the config to how it was before "${entry.note ?? "this change"}" ` +
        `(${entry.at})? The current config is snapshotted first, so this is reversible.`,
      header: "Roll back config",
      icon: "pi pi-history",
      acceptLabel: "Roll back",
      rejectLabel: "Cancel",
      acceptClass: "p-button-danger",
      accept: () => void doRollback(entry.id),
    });
  }

  async function doRollback(id: number): Promise<void> {
    busyId.value = id;
    try {
      const res = await apiSend<{ ok: boolean; changed?: boolean }>(
        "POST",
        `/api/config/history/${id}/rollback`,
        {},
      );
      const noChange = res.changed === false;
      toast.add({
        severity: noChange ? "info" : "success",
        summary: noChange ? "Already current" : "Config rolled back",
        detail: noChange
          ? "That snapshot matches the current config — nothing changed."
          : "The bot applies it automatically.",
        life: 4000,
      });
      await load();
    } catch (err) {
      toast.add({
        severity: "error",
        summary: "Rollback failed",
        detail: (err as Error).message,
        life: 5000,
      });
    } finally {
      busyId.value = null;
    }
  }

  return { entries, retentionDays, loading, busyId, load, confirmRollback };
}
