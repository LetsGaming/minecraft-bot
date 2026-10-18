import { computed, reactive, ref } from "vue";
import { UnauthorizedError, ApiError } from "../api";
import type {
  InstalledMod,
  InstalledMods,
  ModApplyResult,
  ModRemoveResult,
  ModToggleResult,
  ModUpdateCheck,
} from "../api";
import { errorMessage } from "../utils/errorMessage";
import { t } from "../i18n";
import { useRowBusy } from "./useRowBusy";
import { latest } from "./useLoader";

export type RowAction = "update" | "remove" | "disable" | "enable";

export interface InstalledModsApi {
  fetchInstalled(): Promise<InstalledMods>;
  checkUpdates(refresh?: boolean): Promise<ModUpdateCheck>;
  updateOne(slug: string): Promise<ModApplyResult>;
  remove(slug: string): Promise<ModRemoveResult>;
  disable(slug: string): Promise<ModToggleResult>;
  enable(slug: string): Promise<ModToggleResult>;
  applyUpdates(): Promise<ModApplyResult>;
}

/** A failed request as the Mods view shows it: the message and, when the server answered, its status. */
export interface RequestFailure {
  message: string;
  status: number | null;
}

/** What one row action ended with; `ok: false` carries the wrapper's or the request's error. */
export interface RowOutcome {
  ok: boolean;
  error: string;
  /** For update and apply-all: how many mods the wrapper changed. */
  changed: number;
}

function failureOf(err: unknown): RequestFailure {
  return {
    message: errorMessage(err, ""),
    status: err instanceof ApiError ? err.status : null,
  };
}

/**
 * The installed half of the Mods view: the list, the update check, and one
 * action per row at a time while the other rows stay usable. Failures are
 * kept as state for the view to show; nothing is swallowed except a 401,
 * which the shell turns into the login screen.
 */
export function useInstalledMods(api: InstalledModsApi) {
  const installed = ref<InstalledMods | null>(null);
  const loading = ref(false);
  const loadError = ref<RequestFailure | null>(null);

  const updates = ref<Map<string, string>>(new Map());
  const checkingUpdates = ref(false);
  const updatesError = ref("");
  const applyingAll = ref(false);

  /** Slugs changed in this session; the running server picks them up on its next start. */
  const changedSinceLoad = reactive(new Set<string>());

  const rows = useRowBusy<string>();

  const mods = computed<InstalledMod[]>(() => installed.value?.mods ?? []);
  /** Only installed mods count; the update check may still list one removed since. */
  const updateCount = computed(() => mods.value.filter((m) => updates.value.has(m.slug)).length);

  function hasUpdate(slug: string): boolean {
    return updates.value.has(slug);
  }

  const loads = latest();

  /** Only the newest read is adopted, so a slow answer for a server left behind cannot replace the new list. */
  async function load(): Promise<void> {
    const current = loads.begin();
    loading.value = true;
    try {
      const res = await api.fetchInstalled();
      if (!current()) return;
      installed.value = res;
      loadError.value = null;
    } catch (err) {
      if (current() && !(err instanceof UnauthorizedError)) loadError.value = failureOf(err);
    } finally {
      if (current()) loading.value = false;
    }
  }

  async function refreshUpdates(refresh = true): Promise<void> {
    checkingUpdates.value = true;
    try {
      const res = await api.checkUpdates(refresh);
      const next = new Map<string, string>();
      for (const r of res.results) {
        if (r.status === "update_available") next.set(r.slug, String(r.latestVersionId ?? ""));
      }
      updates.value = next;
      updatesError.value = "";
    } catch (err) {
      if (!(err instanceof UnauthorizedError)) updatesError.value = failureOf(err).message || t("mods.installed.updateCheckFailed");
    } finally {
      checkingUpdates.value = false;
    }
  }

  function call(slug: string, action: RowAction) {
    switch (action) {
      case "update":
        return api.updateOne(slug);
      case "remove":
        return api.remove(slug);
      case "disable":
        return api.disable(slug);
      case "enable":
        return api.enable(slug);
    }
  }

  /**
   * Runs one action on one row and reloads what it changed. The update check
   * is only asked again when the set of builds changed (update, remove).
   */
  async function runRow(slug: string, action: RowAction, label = ""): Promise<RowOutcome> {
    if (rows.isLocked(slug)) return { ok: false, error: "", changed: 0 };
    return rows.run(
      slug,
      async () => {
        let outcome: RowOutcome;
        try {
          const r = await call(slug, action);
          let changed = action === "update" ? ((r as ModApplyResult).updated?.length ?? 0) : 1;
          if (!r.ok) changed = 0;
          outcome = { ok: r.ok, error: r.ok ? "" : (r.error ?? ""), changed };
        } catch (err) {
          return { ok: false, error: failureOf(err).message, changed: 0 };
        }
        if (outcome.ok) {
          if (outcome.changed > 0) changedSinceLoad.add(slug);
          await Promise.all([
            load(),
            action === "update" || action === "remove" ? refreshUpdates(true) : Promise.resolve(),
          ]);
        }
        return outcome;
      },
      { label },
    );
  }

  async function applyAll(): Promise<RowOutcome> {
    if (applyingAll.value) return { ok: false, error: "", changed: 0 };
    applyingAll.value = true;
    try {
      const r = await api.applyUpdates();
      const changed = r.updated?.length ?? 0;
      if (r.ok) {
        for (const u of r.updated ?? []) changedSinceLoad.add(u.slug);
        await Promise.all([load(), refreshUpdates(true)]);
      }
      return { ok: r.ok, error: r.ok ? "" : (r.error ?? ""), changed };
    } catch (err) {
      return { ok: false, error: failureOf(err).message, changed: 0 };
    } finally {
      applyingAll.value = false;
    }
  }

  /** A server switch: forget the old server's list, errors and markers. */
  function reset(): void {
    loads.cancel();
    loading.value = false;
    installed.value = null;
    loadError.value = null;
    updates.value = new Map();
    updatesError.value = "";
    changedSinceLoad.clear();
  }

  return {
    installed,
    mods,
    loading,
    loadError,
    updates,
    updateCount,
    checkingUpdates,
    updatesError,
    applyingAll,
    changedSinceLoad,
    isBusy: rows.isBusy,
    isLocked: rows.isLocked,
    busyLabel: rows.busyLabel,
    hasUpdate,
    load,
    refreshUpdates,
    runRow,
    applyAll,
    reset,
  };
}
