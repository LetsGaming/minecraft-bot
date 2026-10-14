import { computed, ref } from "vue";
import type { UpgradeEvent, UpgradeJob, UpgradeRequest, UpgradeStarted } from "@mcbot/schema/wire/index.js";
import { phaseRows } from "@mcbot/schema/upgradePhases.js";

export { phaseRows, type PhaseRow } from "@mcbot/schema/upgradePhases.js";

/**
 * The Upgrade page's job state: start the wrapper's upgrade through the
 * backend, then follow it. Progress comes as events after a cursor, so each
 * poll carries only what is new. The poll pauses while the tab is hidden and
 * resumes when it returns; a page reload re-attaches to a running job through
 * `attach`. Every failure goes to `onError`; nothing is swallowed.
 */

export const UPGRADE_POLL_MS = 2000;

/** A finished upgrade older than this is not shown as "the last upgrade". */
export const RECENT_RESULT_SECONDS = 24 * 3600;

/** The steps of a clean upgrade, in order. */
export const UPGRADE_STEPS = ["plan", "countdown", "stop", "backup", "apply", "start"] as const;

/** A prune-only job has no install: its fifth step is the prune. */
export const PRUNE_STEPS = ["plan", "countdown", "stop", "backup", "prune", "start"] as const;

export interface UpgradeApi {
  support(): Promise<{ supported: boolean }>;
  start(body: UpgradeRequest): Promise<UpgradeStarted>;
  poll(jobId: string, since: number): Promise<UpgradeJob>;
  /** The running or latest job; null when there has been none. */
  current(since: number): Promise<UpgradeJob | null>;
}

export interface PageVisibility {
  isHidden(): boolean;
  onVisible(cb: () => void): () => void;
}

export interface UseServerUpgradeOptions {
  api: UpgradeApi;
  onError: (message: string) => void;
  visibility?: PageVisibility;
  /** Epoch seconds; injectable for tests. */
  nowSeconds?: () => number;
}

const browserVisibility: PageVisibility = {
  isHidden: () => typeof document !== "undefined" && document.hidden,
  onVisible(cb) {
    if (typeof document === "undefined") return () => undefined;
    const handler = () => {
      if (!document.hidden) cb();
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  },
};

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function useServerUpgrade(options: UseServerUpgradeOptions) {
  const visibility = options.visibility ?? browserVisibility;
  const nowSeconds = options.nowSeconds ?? (() => Date.now() / 1000);

  const supported = ref<boolean | null>(null);
  const starting = ref(false);
  const job = ref<UpgradeJob | null>(null);
  const events = ref<UpgradeEvent[]>([]);

  let jobId: string | null = null;
  let cursor = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  const stopWatching = visibility.onVisible(() => {
    if (jobId && timer === undefined && running.value) schedule();
  });

  const running = computed(() => job.value?.state === "running");
  const finished = computed(() => job.value !== null && job.value.state !== "running");
  const result = computed(() => job.value?.result ?? null);
  const phases = computed(() => phaseRows(events.value));
  const stepsDone = computed(
    () =>
      (job.value?.kind === "prune" ? PRUNE_STEPS : UPGRADE_STEPS).filter((s) =>
        phases.value.some((p) => p.phase === s && p.status === "done"),
      ).length,
  );

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule(): void {
    clearTimer();
    if (disposed || visibility.isHidden()) return;
    const mine = generation;
    timer = setTimeout(() => {
      timer = undefined;
      if (visibility.isHidden()) return;
      void tick(mine);
    }, UPGRADE_POLL_MS);
  }

  function absorb(next: UpgradeJob): void {
    if (next.events.length > 0) events.value = [...events.value, ...next.events];
    cursor = next.next;
    job.value = next;
  }

  async function tick(mine: number): Promise<void> {
    if (mine !== generation || !jobId) return;
    try {
      const next = await options.api.poll(jobId, cursor);
      if (mine !== generation) return;
      absorb(next);
      if (next.state === "running") {
        schedule();
        return;
      }
      jobId = null;
    } catch (err) {
      if (mine !== generation) return;
      // One missed poll is not the end of the job; the wrapper may be restarting.
      options.onError(messageOf(err, "Could not read the upgrade's progress."));
      schedule();
    }
  }

  async function loadSupport(): Promise<void> {
    try {
      supported.value = (await options.api.support()).supported;
    } catch (err) {
      supported.value = false;
      options.onError(messageOf(err, "Could not check whether this server can upgrade."));
    }
  }

  /** Pick up a job that is already running (or finished recently) after a page load. */
  async function attach(): Promise<void> {
    generation++;
    const mine = generation;
    try {
      const found = await options.api.current(0);
      if (mine !== generation || !found) return;
      const last = found.events.length > 0 ? found.events[found.events.length - 1]!.ts : 0;
      const recent = nowSeconds() - last < RECENT_RESULT_SECONDS;
      if (found.state !== "running" && !recent) return;
      events.value = [];
      cursor = 0;
      absorb(found);
      if (found.state === "running") {
        jobId = found.jobId;
        schedule();
      }
    } catch (err) {
      if (mine !== generation) return;
      options.onError(messageOf(err, "Could not read the last upgrade."));
    }
  }

  async function start(request: UpgradeRequest): Promise<boolean> {
    if (starting.value || running.value) return false;
    generation++;
    const mine = generation;
    clearTimer();
    starting.value = true;
    try {
      const started = await options.api.start(request);
      if (mine !== generation) return false;
      events.value = [];
      cursor = 0;
      jobId = started.jobId;
      job.value = {
        jobId: started.jobId,
        state: "running",
        mcVersion: request.mcVersion,
        events: [],
        next: 0,
      };
      schedule();
      return true;
    } catch (err) {
      options.onError(messageOf(err, "Could not start the upgrade."));
      return false;
    } finally {
      starting.value = false;
    }
  }

  /** Forget the job: a server switch. */
  function reset(): void {
    generation++;
    clearTimer();
    jobId = null;
    cursor = 0;
    job.value = null;
    events.value = [];
    supported.value = null;
  }

  function dispose(): void {
    disposed = true;
    reset();
    stopWatching();
  }

  return {
    supported,
    starting,
    job,
    events,
    running,
    finished,
    result,
    phases,
    stepsDone,
    loadSupport,
    attach,
    start,
    reset,
    dispose,
  };
}
