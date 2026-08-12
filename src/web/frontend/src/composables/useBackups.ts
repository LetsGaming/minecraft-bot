import { ref, computed } from "vue";
import { apiGet, apiSend } from "../api";
import type { StaleInfo } from "@mcbot/schema/contract.js";
import { errorMessage } from "../utils/errorMessage";
import type { BackupFileInfo } from "../api";

/**
 * DSH-03 — the backup panel's client half.
 *
 * Per-view state rather than a module singleton: the list is per server, and
 * caching it across servers would show one server's archives under another's
 * name at the moment of switching.
 */

const PAGE_SIZE = 50;

export function useBackups() {
  const files = ref<BackupFileInfo[]>([]);
  const total = ref(0);
  /** Set when the index came from cache because the wrapper did not answer. */
  const stale = ref<StaleInfo | null>(null);
  const cursor = ref<string | null>(null);
  const loading = ref(false);
  const restoring = ref("");
  const error = ref("");
  let serverId = "";

  const hasMore = computed(() => cursor.value !== null);

  async function load(id: string, append = false): Promise<void> {
    if (loading.value) return;
    serverId = id;
    loading.value = true;
    error.value = "";
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (append && cursor.value) params.set("cursor", cursor.value);

      const res = await apiGet<{
        files: BackupFileInfo[];
        nextCursor: string | null;
        total: number;
        stale?: StaleInfo | null;
      }>(
        `/api/servers/${encodeURIComponent(id)}/backups/files?${params.toString()}`,
      );

      files.value = append ? [...files.value, ...res.files] : res.files;
      cursor.value = res.nextCursor;
      total.value = res.total;
      stale.value = res.stale ?? null;
    } catch (err) {
      error.value = errorMessage(err);
      if (!append) files.value = [];
    } finally {
      loading.value = false;
    }
  }

  function loadMore(): Promise<void> {
    return load(serverId, true);
  }

  /**
   * Start a download.
   *
   * A plain navigation rather than fetch-then-blob, and that is the point:
   * these archives run to gigabytes, so letting the browser own the transfer
   * means it streams to disk, shows its own progress from the Content-Length
   * the backend forwards, and can resume. Pulling it into JS memory first
   * would defeat every one of those.
   */
  function download(fileId: string): void {
    window.location.href =
      `/api/servers/${encodeURIComponent(serverId)}` +
      `/backups/files/${encodeURIComponent(fileId)}/download`;
  }

  async function restore(file: BackupFileInfo): Promise<boolean> {
    restoring.value = file.id;
    error.value = "";
    try {
      const res = await apiSend<{ ok: boolean; exitCode: number | null }>(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}` +
          `/backups/files/${encodeURIComponent(file.id)}/restore`,
      );
      if (!res.ok) error.value = `Restore exited with code ${res.exitCode}.`;
      return res.ok;
    } catch (err) {
      error.value = errorMessage(err);
      return false;
    } finally {
      restoring.value = "";
    }
  }

  return {
    files,
    total,
    stale,
    loading,
    restoring,
    error,
    hasMore,
    load,
    loadMore,
    download,
    restore,
  };
}
