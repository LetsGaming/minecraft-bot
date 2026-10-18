import { computed, ref } from "vue";
import { useNotify } from "./useNotify";
import { apiGet, apiSend } from "../api";
import { absoluteStamp } from "../utils/time";
import { humaniseIds } from "../utils/humaniseIds";
import { t } from "../i18n";
import { useConfirmAction } from "./useConfirmAction";
import { useLoader } from "./useLoader";

const DEFAULT_RETENTION_DAYS = 3;

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
  const notify = useNotify();
  const confirmAction = useConfirmAction();

  const loader = useLoader(() =>
    apiGet<{ retentionDays: number; entries: ConfigHistoryEntry[] }>("/api/config/history"),
  );
  const entries = computed<ConfigHistoryEntry[]>(() => loader.data.value?.entries ?? []);
  const retentionDays = computed(() => loader.data.value?.retentionDays ?? DEFAULT_RETENTION_DAYS);
  const { loading, loaded, error, failure } = loader;
  const busyId = ref<number | null>(null);

  async function load(): Promise<void> {
    await loader.load();
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
      if (noChange) notify.info(t("audit.rollback.unchanged"), t("audit.rollback.unchangedDetail"));
      else notify.ok(t("audit.rollback.done"), t("audit.rollback.doneDetail"));
      await load();
    } catch (err) {
      notify.fail(t("audit.rollback.failed"), err);
    } finally {
      busyId.value = null;
    }
  }

  return { entries, retentionDays, loading, loaded, error, failure, busyId, load, confirmRollback, changeName };
}
