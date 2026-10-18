import { computed, ref } from "vue";
import type { ModCompatJob, ModCompatMod } from "../api";
import { errorMessage } from "../utils/errorMessage";
import { t } from "../i18n";
import type { PageVisibility } from "../utils/pageVisibility";
import { usePolledJob } from "./usePolledJob";

export type { PageVisibility } from "../utils/pageVisibility";

/**
 * The Mods tab's "check another Minecraft version" state.
 *
 * Starts the wrapper's background job through the backend and polls it. The
 * poll stops when the job finishes or fails, when the tab is hidden (it picks
 * up again when the tab returns), and on `dispose`. Every failure is reported
 * through `onError`; nothing is swallowed.
 */

/** Same shape the wrapper and backend accept for a Minecraft version. */
export const MC_VERSION_RE = /^[A-Za-z0-9_.-]{1,20}$/;

export const POLL_INTERVAL_MS = 1500;

export type CompatFilter = "all" | "blockers" | "ready";

export interface ModCompatApi {
  start(mcVersion: string, refresh: boolean): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<ModCompatJob>;
  versions(): Promise<{ versions: string[] }>;
}

export interface UseModCompatOptions {
  api: ModCompatApi;
  /** The version the server runs now; listed first in the picker. */
  installedVersion: () => string | null | undefined;
  onError: (message: string) => void;
  visibility?: PageVisibility;
}

export function useModCompat(options: UseModCompatOptions) {
  const releases = ref<string[]>([]);
  const loadingVersions = ref(false);
  const selected = ref("");
  const customVersion = ref("");
  const useCustom = ref(false);

  const checkingCompat = ref(false);
  const job = ref<ModCompatJob | null>(null);
  const checkedVersion = ref<string | null>(null);
  const stale = ref(false);
  const filter = ref<CompatFilter>("all");

  let jobId: string | null = null;
  let generation = 0;

  const poller = usePolledJob<ModCompatJob>({
    intervalMs: POLL_INTERVAL_MS,
    visibility: options.visibility,
    poll: () => options.api.poll(jobId as string),
    onUpdate: (next) => {
      job.value = next;
    },
    isDone: (next) => next.state !== "running",
    onDone: (next) => {
      checkingCompat.value = false;
      jobId = null;
      if (next.state === "failed") {
        options.onError(next.error ?? t("mods.compat.failed"));
      }
    },
    onError: (err) => {
      checkingCompat.value = false;
      jobId = null;
      options.onError(errorMessage(err, t("mods.compat.readFailed")));
    },
  });

  /** The installed version first, then releases newest first, without repeats. */
  const versionChoices = computed(() => {
    const installed = options.installedVersion();
    const list: string[] = installed ? [installed] : [];
    for (const v of releases.value) if (!list.includes(v)) list.push(v);
    return list;
  });

  const targetVersion = computed(() =>
    (useCustom.value ? customVersion.value.trim() : selected.value),
  );
  const targetValid = computed(() => MC_VERSION_RE.test(targetVersion.value));

  const progressText = computed(() => {
    const p = job.value?.progress;
    if (!checkingCompat.value) return "";
    if (!p || p.total === 0) return t("mods.compat.starting");
    return t("mods.compat.checking", { done: Math.min(p.done + 1, p.total), total: p.total });
  });

  /** Final answer when done, otherwise whatever has arrived so far. */
  const rows = computed<ModCompatMod[]>(() => {
    const j = job.value;
    if (!j) return [];
    return j.state === "done" ? (j.mods ?? []) : j.partial;
  });

  const bySlug = computed(() => new Map(rows.value.map((m) => [m.slug, m])));

  function forSlug(slug: string): ModCompatMod | undefined {
    return bySlug.value.get(slug);
  }

  function isBlocker(slug: string): boolean {
    const m = forSlug(slug);
    return m !== undefined && m.availability !== "available";
  }

  const summary = computed(() =>
    job.value?.state === "done" ? (job.value.summary ?? null) : null,
  );

  const summaryText = computed(() => {
    const s = summary.value;
    if (!s) return "";
    return t("mods.compat.summary", { available: s.available, unavailable: s.unavailable, unknown: s.unknown });
  });

  const failed = computed(() => job.value?.state === "failed");
  const hasResult = computed(() => job.value?.state === "done");
  const emptyResult = computed(() => hasResult.value && (job.value?.summary?.total ?? 0) === 0);

  async function loadVersions(): Promise<void> {
    loadingVersions.value = true;
    try {
      releases.value = (await options.api.versions()).versions;
    } catch (err) {
      releases.value = [];
      options.onError(errorMessage(err, t("mods.compat.versionsFailed")));
    } finally {
      loadingVersions.value = false;
    }
    if (!selected.value) selected.value = versionChoices.value[0] ?? "";
    if (releases.value.length === 0) useCustom.value = true;
  }

  async function check(refresh = false): Promise<void> {
    if (checkingCompat.value) return;
    const version = targetVersion.value;
    if (!MC_VERSION_RE.test(version)) {
      options.onError(t("mods.compat.versionInvalid"));
      return;
    }
    generation++;
    const mine = generation;
    poller.stop();
    checkingCompat.value = true;
    stale.value = false;
    job.value = null;
    checkedVersion.value = version;
    try {
      const started = await options.api.start(version, refresh);
      if (mine !== generation) return;
      jobId = started.jobId;
      await poller.start({ immediate: true });
    } catch (err) {
      if (mine !== generation) return;
      checkingCompat.value = false;
      jobId = null;
      options.onError(errorMessage(err, t("mods.compat.startFailed")));
    }
  }

  /** The installed mods changed, so a finished answer no longer matches them. */
  function markStale(): void {
    if (hasResult.value) stale.value = true;
  }

  /** Forget the job: a server switch or a hidden control. */
  function reset(): void {
    generation++;
    poller.stop();
    jobId = null;
    checkingCompat.value = false;
    job.value = null;
    checkedVersion.value = null;
    stale.value = false;
    filter.value = "all";
  }

  function dispose(): void {
    reset();
    poller.dispose();
  }

  return {
    releases,
    loadingVersions,
    selected,
    customVersion,
    useCustom,
    versionChoices,
    targetVersion,
    targetValid,
    checkingCompat,
    job,
    checkedVersion,
    stale,
    filter,
    progressText,
    rows,
    summary,
    summaryText,
    failed,
    hasResult,
    emptyResult,
    forSlug,
    isBlocker,
    loadVersions,
    check,
    markStale,
    reset,
    dispose,
  };
}
