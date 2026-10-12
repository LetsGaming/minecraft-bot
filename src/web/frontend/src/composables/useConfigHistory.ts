import { ref } from "vue";
import { errorMessage } from "../utils/errorMessage";
import { loadFailure, type LoadFailure } from "../utils/loadFailure";
import { useToast } from "primevue/usetoast";
import { apiGet, apiSend } from "../api";
import { absoluteStamp } from "../utils/time";
import { humaniseIds } from "../utils/humaniseIds";
import { t } from "../i18n";
import { useConfirmAction } from "./useConfirmAction";

export interface ConfigHistoryEntry {
  id: number;
  at: string;
  by: string | null;
  note: string | null;
}

/**
 * Config rollback history and the rollback action. Each entry is the config as
 * it was BEFORE a change (kept a few days), so restoring one reverts to just
 * before that change. Rolling back is itself snapshotted first, so it can be
 * rolled back in turn; the confirm says so.
 */
export function useConfigHistory(knownGuildName: (id: string) => string | undefined = () => undefined) {
  const toast = useToast();
  const confirmAction = useConfirmAction();

  const entries = ref<ConfigHistoryEntry[]>([]);
  const retentionDays = ref(3);
  const loading = ref(false);
  /** False until the first answer, success or failure, has arrived. */
  const loaded = ref(false);
  const error = ref("");
  const failure = ref<LoadFailure | null>(null);
  const busyId = ref<number | null>(null);

  async function load(): Promise<void> {
    loading.value = true;
    error.value = "";
    failure.value = null;
    try {
      const res = await apiGet<{
        retentionDays: number;
        entries: ConfigHistoryEntry[];
      }>("/api/config/history");
      entries.value = res.entries;
      retentionDays.value = res.retentionDays;
    } catch (err) {
      entries.value = [];
      error.value = errorMessage(err);
      failure.value = loadFailure(err);
    } finally {
      loading.value = false;
      loaded.value = true;
    }
  }

  function changeName(entry: ConfigHistoryEntry): string {
    return entry.note ? humaniseIds(entry.note, knownGuildName) : t("audit.history.unnamedChange");
  }

  async function confirmRollback(entry: ConfigHistoryEntry): Promise<void> {
    const when = absoluteStamp(entry.at);
    const result = await confirmAction({
      level: "disruptive",
      tone: "warn",
      header: t("audit.rollback.header", { when }),
      message: t("audit.rollback.message", { change: changeName(entry) }),
      acceptLabel: t("audit.rollback.accept"),
      facts: [
        { term: t("audit.rollback.factApplies"), detail: t("audit.rollback.applies") },
        { term: t("audit.rollback.factRecover"), detail: t("audit.rollback.recover") },
      ],
    });
    if (result === "confirm") await doRollback(entry.id);
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
        summary: noChange ? t("audit.rollback.unchanged") : t("audit.rollback.done"),
        detail: noChange ? t("audit.rollback.unchangedDetail") : t("audit.rollback.doneDetail"),
        life: 5000,
      });
      await load();
    } catch (err) {
      toast.add({
        severity: "error",
        summary: t("audit.rollback.failed"),
        detail: errorMessage(err),
        life: 6000,
      });
    } finally {
      busyId.value = null;
    }
  }

  return { entries, retentionDays, loading, loaded, error, failure, busyId, load, confirmRollback, changeName };
}
