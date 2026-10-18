import { computed, ref } from "vue";
import type { UpgradeEvent, UpgradeJob, UpgradeRequest, UpgradeStarted } from "@mcbot/schema/wire/index.js";
import { MS } from "@mcbot/schema";
import { apiGet, apiSend } from "../api";
import { safeStorage } from "../utils/safeStorage";
import { errorMessage } from "../utils/errorMessage";
import type { PageVisibility } from "../utils/pageVisibility";
import { usePolledJob } from "./usePolledJob";

export type { PageVisibility } from "../utils/pageVisibility";
import { PRUNE_PHASES, UPGRADE_PHASES, phaseRows } from "@mcbot/schema/upgradePhases.js";

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
export const RECENT_RESULT_SECONDS = MS.day / MS.second;

export interface UpgradeApi {
  support(): Promise<{ supported: boolean }>;
  start(body: UpgradeRequest): Promise<UpgradeStarted>;
  poll(jobId: string, since: number): Promise<UpgradeJob>;
  /** The running or latest job; null when there has been none. */
  current(since: number): Promise<UpgradeJob | null>;
}

/** The upgrade routes of one server. The prune page follows its delete through the same routes and overrides `start`. */
export function useUpgradeApi(server: () => string): UpgradeApi {
  const base = (): string => `/api/servers/${encodeURIComponent(server())}/upgrade`;
  return {
    support: () => apiGet<{ supported: boolean }>(`${base()}/support`),
    start: (body) => apiSend<UpgradeStarted>("POST", base(), body),
    poll: (jobId, since) => apiGet<UpgradeJob>(`${base()}/${encodeURIComponent(jobId)}?since=${since}`),
    current: async (since) => (await apiGet<{ job: UpgradeJob | null }>(`${base()}/current?since=${since}`)).job,
  };
}

/** Finished jobs the viewer has closed, so the page does not reopen them. */
export interface DismissedJobs {
  has(jobId: string): boolean;
  add(jobId: string): void;
}

export interface UseServerUpgradeOptions {
  api: UpgradeApi;
  onError: (message: string) => void;
  visibility?: PageVisibility;
  /** Epoch seconds; injectable for tests. */
  nowSeconds?: () => number;
  dismissed?: DismissedJobs;
  /**
   * Which finished jobs this page shows after a load: the Upgrade page its
   * upgrades, the Prune page its deletes. Both go through the same routes; a
   * running job of either kind is always shown, since it blocks a new one.
   */
  kind?: JobKind;
}

export type JobKind = NonNullable<UpgradeJob["kind"]>;

/** Wrappers before prune-only jobs report no kind: those jobs are upgrades. */
const kindOf = (j: UpgradeJob): JobKind => j.kind ?? "upgrade";

const DISMISSED_KEY = "mcbot.upgrade.dismissed";
const DISMISSED_KEEP = 20;

/**
 * Closed results, kept in this browser: a finished job is shown for a day after
 * a page load, and without this the one just closed came straight back. Storage
 * can be missing or blocked; the page then only remembers until it is reloaded.
 */
function browserDismissed(): DismissedJobs {
  let ids: string[] = [];
  try {
    const raw = JSON.parse(safeStorage.get(DISMISSED_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) ids = raw.filter((v): v is string => typeof v === "string");
  } catch {
    /* no storage: memory only */
  }
  return {
    has: (jobId) => ids.includes(jobId),
    add(jobId) {
      if (ids.includes(jobId)) return;
      ids = [...ids, jobId].slice(-DISMISSED_KEEP);
      safeStorage.set(DISMISSED_KEY, JSON.stringify(ids));
    },
  };
}

export function useServerUpgrade(options: UseServerUpgradeOptions) {
  const nowSeconds = options.nowSeconds ?? (() => Date.now() / MS.second);
  const dismissed = options.dismissed ?? browserDismissed();

  const supported = ref<boolean | null>(null);
  const starting = ref(false);
  const job = ref<UpgradeJob | null>(null);
  const events = ref<UpgradeEvent[]>([]);

  let jobId: string | null = null;
  let cursor = 0;
  let generation = 0;

  const poller = usePolledJob<UpgradeJob>({
    intervalMs: UPGRADE_POLL_MS,
    visibility: options.visibility,
    poll: () => options.api.poll(jobId as string, cursor),
    onUpdate: (next) => absorb(next),
    isDone: (next) => next.state !== "running",
    onDone: () => {
      jobId = null;
    },
    onError: (err) => {
      options.onError(errorMessage(err, "Could not read the upgrade's progress."));
    },
  });

  const running = computed(() => job.value?.state === "running");
  const finished = computed(() => job.value !== null && job.value.state !== "running");
  const result = computed(() => job.value?.result ?? null);
  const phases = computed(() => phaseRows(events.value));
  const stepsDone = computed(
    () =>
      (job.value?.kind === "prune" ? PRUNE_PHASES : UPGRADE_PHASES).filter((s) =>
        phases.value.some((p) => p.phase === s && p.status === "done"),
      ).length,
  );

  function absorb(next: UpgradeJob): void {
    if (next.events.length > 0) events.value = [...events.value, ...next.events];
    cursor = next.next;
    job.value = next;
  }

  async function loadSupport(): Promise<void> {
    try {
      supported.value = (await options.api.support()).supported;
    } catch (err) {
      supported.value = false;
      options.onError(errorMessage(err, "Could not check whether this server can upgrade."));
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
      if (found.state !== "running") {
        if (!recent || dismissed.has(found.jobId)) return;
        if (options.kind && kindOf(found) !== options.kind) return;
      }
      events.value = [];
      cursor = 0;
      absorb(found);
      if (found.state === "running") {
        jobId = found.jobId;
        void poller.start();
      }
    } catch (err) {
      if (mine !== generation) return;
      options.onError(errorMessage(err, "Could not read the last upgrade."));
    }
  }

  async function start(request: UpgradeRequest): Promise<boolean> {
    if (starting.value || running.value) return false;
    generation++;
    const mine = generation;
    poller.stop();
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
      void poller.start();
      return true;
    } catch (err) {
      options.onError(errorMessage(err, "Could not start the upgrade."));
      return false;
    } finally {
      starting.value = false;
    }
  }

  /** Forget the job: a server switch. */
  function reset(): void {
    generation++;
    poller.stop();
    jobId = null;
    cursor = 0;
    job.value = null;
    events.value = [];
    supported.value = null;
  }

  /** Close a finished job's result for good: a later attach() does not bring it back. */
  function dismiss(): void {
    const closed = job.value;
    if (closed && closed.state !== "running") dismissed.add(closed.jobId);
    reset();
  }

  function dispose(): void {
    reset();
    poller.dispose();
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
    dismiss,
    dispose,
  };
}
