import { ref, computed } from "vue";
import { ApiError, apiGet, apiSend } from "../api";
import type { StaleInfo } from "@mcbot/schema/contract.js";
import { errorMessage } from "../utils/errorMessage";
import { t } from "../i18n";
import type { BackupFileInfo, BackupSummaryResponse } from "../api";

/**
 * The backup panel's client half.
 *
 * Per-view state rather than a module singleton: the list is per server, and
 * caching it across servers would show one server's archives under another's
 * name at the moment of switching.
 *
 * `error` belongs to the list. Create, restore and delete report their own
 * outcome to the caller, so a failed delete never replaces a list that loaded.
 */

const PAGE_SIZE = 50;

/** What a script run reported: exit code and the tail of its output. */
export interface ScriptOutcome {
  ok: boolean;
  exitCode: number | null;
  output: string;
  /** Set when the request itself failed and no script result came back. */
  error: string;
}

export interface ActionOutcome {
  ok: boolean;
  error: string;
}

interface ScriptResponse {
  ok: boolean;
  exitCode: number | null;
  output?: string;
  stderr?: string;
}

function outcomeOf(res: ScriptResponse): ScriptOutcome {
  const output = [res.output ?? "", res.stderr ?? ""]
    .filter((part) => part.trim() !== "")
    .join("\n")
    .replace(/\r\n?/g, "\n");
  return { ok: res.ok, exitCode: res.exitCode, output, error: "" };
}

export function useBackups() {
  const files = ref<BackupFileInfo[]>([]);
  const total = ref(0);
  /** Set when the index came from cache because the wrapper did not answer. */
  const stale = ref<StaleInfo | null>(null);
  const cursor = ref<string | null>(null);
  const loading = ref(false);
  /** True until the first page of the current server has arrived or failed. */
  const initialLoad = ref(true);
  const error = ref("");
  /** HTTP status of the failed list request, for the error's detail line. */
  const errorStatus = ref<number | null>(null);
  const summary = ref<BackupSummaryResponse | null>(null);
  const summaryError = ref("");
  let serverId = "";

  const hasMore = computed(() => cursor.value !== null);

  /**
   * AUD-011: bumped by every list request, so only the newest answer lands.
   * Returning early while a request was in flight dropped a server switch:
   * the header said B while the list, and every delete, restore or download
   * built from it, still pointed at A.
   */
  let generation = 0;

  async function load(id: string, append = false): Promise<void> {
    // "Load more" on the same server waits for the page in flight; anything
    // else (a switch, a refresh) supersedes it.
    if (append && loading.value && id === serverId) return;
    const mine = ++generation;
    if (id !== serverId) {
      // Nothing of the old server may stay on screen to be acted on.
      initialLoad.value = true;
      files.value = [];
      cursor.value = null;
      total.value = 0;
      summary.value = null;
    }
    serverId = id;
    loading.value = true;
    error.value = "";
    errorStatus.value = null;
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

      if (mine !== generation) return;
      files.value = append ? [...files.value, ...res.files] : res.files;
      cursor.value = res.nextCursor;
      total.value = res.total;
      stale.value = res.stale ?? null;
    } catch (err) {
      if (mine !== generation) return;
      error.value = errorMessage(err);
      errorStatus.value = err instanceof ApiError ? err.status : null;
      if (!append) files.value = [];
    } finally {
      if (mine === generation) {
        loading.value = false;
        initialLoad.value = false;
      }
    }
  }

  function loadMore(): Promise<void> {
    return load(serverId, true);
  }

  /** Counts and sizes per folder. Optional: the list works without it. */
  async function loadSummary(id: string): Promise<void> {
    summaryError.value = "";
    try {
      const res = await apiGet<BackupSummaryResponse>(
        `/api/servers/${encodeURIComponent(id)}/backups/summary`,
      );
      if (id === serverId) summary.value = res;
    } catch (err) {
      if (id !== serverId) return;
      summary.value = null;
      summaryError.value = errorMessage(err);
    }
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
  /** Is this archive one of the current server's, as listed now? (AUD-011) */
  function listed(fileId: string): boolean {
    return files.value.some((f) => f.id === fileId);
  }

  function download(fileId: string): void {
    if (!listed(fileId)) return;
    window.location.href =
      `/api/servers/${encodeURIComponent(serverId)}` +
      `/backups/files/${encodeURIComponent(fileId)}/download`;
  }

  /** Runs the suite's backup script through the `backup` server action. */
  async function create(): Promise<ScriptOutcome> {
    try {
      const res = await apiSend<ScriptResponse>(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}/backup`,
      );
      return outcomeOf(res);
    } catch (err) {
      return { ok: false, exitCode: null, output: "", error: errorMessage(err) };
    }
  }

  async function restore(file: BackupFileInfo): Promise<ScriptOutcome> {
    // A confirmation opened before a server switch must not land on the
    // server switched to.
    if (!listed(file.id)) {
      return { ok: false, exitCode: null, output: "", error: t("backups.switchedServer") };
    }
    try {
      const res = await apiSend<ScriptResponse>(
        "POST",
        `/api/servers/${encodeURIComponent(serverId)}` +
          `/backups/files/${encodeURIComponent(file.id)}/restore`,
      );
      return outcomeOf(res);
    } catch (err) {
      return { ok: false, exitCode: null, output: "", error: errorMessage(err) };
    }
  }

  /**
   * Permanently delete an archive.
   *
   * Drops the row locally so it's gone immediately, then re-loads: the
   * backend's own readThrough cache is invalidated on delete, but the
   * cursor/total this composable holds still need a fresh first page.
   */
  async function remove(file: BackupFileInfo): Promise<ActionOutcome> {
    if (!listed(file.id)) return { ok: false, error: t("backups.switchedServer") };
    try {
      await apiSend<{ ok: boolean }>(
        "DELETE",
        `/api/servers/${encodeURIComponent(serverId)}` +
          `/backups/files/${encodeURIComponent(file.id)}`,
      );
      files.value = files.value.filter((f) => f.id !== file.id);
      total.value = Math.max(0, total.value - 1);
      void load(serverId);
      void loadSummary(serverId);
      return { ok: true, error: "" };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }

  return {
    files,
    total,
    stale,
    loading,
    initialLoad,
    error,
    errorStatus,
    hasMore,
    summary,
    summaryError,
    load,
    loadMore,
    loadSummary,
    download,
    create,
    restore,
    remove,
  };
}
