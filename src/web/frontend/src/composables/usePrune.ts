import { computed, ref } from "vue";
import { apiGet, apiSend } from "../api";
import { latest } from "./useLoader";
import { usePolledJob } from "./usePolledJob";
import { errorMessage } from "../utils/errorMessage";
import type { PageVisibility } from "../utils/pageVisibility";

export type { PageVisibility } from "../utils/pageVisibility";
import type {
  PruneChunkInfo,
  PruneDimensions,
  PruneEngineStatus,
  PruneScanProgress,
  PruneMap,
  PruneParams,
  PruneParamsRequest,
  PruneScanJob,
  PruneSummary,
  PruneZone,
  UpgradeStarted,
} from "@mcbot/schema/wire/index.js";

/**
 * The chunk prune page's state: the parameters (loaded, edited, saved), the
 * read-only scan job and its summary, the per-dimension maps, and the start of
 * the delete. The scan is polled like the mod compatibility check: paused while
 * the tab is hidden, picked up again when it returns. The delete itself is an
 * upgrade-style job followed by useServerUpgrade.
 */

export const PRUNE_POLL_MS = 1500;

/** Cell classes in a plan map, as the setup suite writes them. */
export const CELL = {
  EMPTY: 0,
  DELETE: 1,
  ACTIVE: 2,
  PROTECTED: 3,
  BUFFER: 4,
  UNREADABLE: 5,
  /** Chosen by hand over a soft rule (in use, buffer). */
  MANUAL_SOFT: 6,
  /** Chosen by hand over a hard protection (needs the override). */
  MANUAL_HARD: 7,
  /** The rules would delete it, but it holds block entities no structure explains. */
  UNCERTAIN: 8,
} as const;

export interface PruneApi {
  support(): Promise<{ supported: boolean }>;
  settings(): Promise<PruneParams>;
  save(params: PruneParamsRequest): Promise<PruneParams>;
  scan(params: PruneParamsRequest): Promise<{ jobId: string }>;
  poll(jobId: string): Promise<PruneScanJob>;
  map(planId: string, index: number): Promise<PruneMap>;
  apply(planId: string, countdownSeconds: number): Promise<UpgradeStarted>;
  /** Optional: a page that offers no dimension choice, progress or cancel can leave these out. */
  dimensions?(): Promise<PruneDimensions>;
  status?(): Promise<PruneEngineStatus>;
  cancel?(jobId: string): Promise<{ cancelled: boolean }>;
  chunk?(planId: string, dimension: string, cx: number, cz: number): Promise<PruneChunkInfo>;
}

/** The prune routes of one server, as the page consumes them. A page that does not offer a call overrides it. */
export function usePruneApi(server: () => string): PruneApi {
  const base = (): string => `/api/servers/${encodeURIComponent(server())}/prune`;
  return {
    support: () => apiGet<{ supported: boolean }>(`${base()}/support`),
    settings: () => apiGet<PruneParams>(`${base()}/settings`),
    save: (p) => apiSend<PruneParams>("PUT", `${base()}/settings`, p),
    scan: (p) => apiSend<{ jobId: string }>("POST", `${base()}/scans`, p),
    poll: (jobId) => apiGet<PruneScanJob>(`${base()}/scans/${encodeURIComponent(jobId)}`),
    map: (planId, index) => apiGet<PruneMap>(`${base()}/plans/${encodeURIComponent(planId)}/map/${index}`),
    dimensions: () => apiGet<PruneDimensions>(`${base()}/dimensions`),
    status: () => apiGet<PruneEngineStatus>(`${base()}/status`),
    cancel: (jobId) => apiSend<{ cancelled: boolean }>("POST", `${base()}/scans/${encodeURIComponent(jobId)}/cancel`, {}),
    chunk: (planId, dimension, cx, cz) =>
      apiGet<PruneChunkInfo>(
        `${base()}/plans/${encodeURIComponent(planId)}/chunk?dimension=${encodeURIComponent(dimension)}&cx=${cx}&cz=${cz}`,
      ),
    apply: (planId, countdownSeconds) =>
      apiSend<UpgradeStarted>("POST", `/api/servers/${encodeURIComponent(server())}/prune`, { planId, countdownSeconds }),
  };
}

export interface UsePruneOptions {
  api: PruneApi;
  onError: (message: string) => void;
  visibility?: PageVisibility;
}

export const emptyParams = (): PruneParams => ({
  thresholdMinutes: 5,
  spawnRadiusChunks: 16,
  playerRadiusChunks: 8,
  bufferChunks: 2,
  zones: [],
  dimensions: null,
  buildProtection: "likely",
});

/** One chunk cell decoded from a map region. */
export interface DecodedRegion {
  cell: Uint8Array;
  heat: Uint8Array;
}

function decode(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Region key r.X.Z to its coordinates, or null for anything else. */
export function parseRegionKey(key: string): { rx: number; rz: number } | null {
  const m = /^r\.(-?\d+)\.(-?\d+)$/.exec(key);
  return m ? { rx: Number(m[1]), rz: Number(m[2]) } : null;
}

export interface DecodedMap {
  dimension: string;
  regions: Array<{ rx: number; rz: number } & DecodedRegion>;
  /** Region bounds, inclusive. */
  bounds: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
}

export function decodeMap(map: PruneMap): DecodedMap {
  const regions: DecodedMap["regions"] = [];
  let bounds: DecodedMap["bounds"] = null;
  for (const [key, value] of Object.entries(map.regions)) {
    const pos = parseRegionKey(key);
    const v = value as { cell?: string; heat?: string };
    if (!pos || typeof v.cell !== "string" || typeof v.heat !== "string") continue;
    regions.push({ ...pos, cell: decode(v.cell), heat: decode(v.heat) });
    bounds = bounds
      ? {
          minX: Math.min(bounds.minX, pos.rx),
          minZ: Math.min(bounds.minZ, pos.rz),
          maxX: Math.max(bounds.maxX, pos.rx),
          maxZ: Math.max(bounds.maxZ, pos.rz),
        }
      : { minX: pos.rx, minZ: pos.rz, maxX: pos.rx, maxZ: pos.rz };
  }
  return { dimension: map.dimension, regions, bounds };
}

/** The dimensions a scan is limited to, given the choice (null means all of them). */
export function dimensionChoice(all: string[], selected: string[] | null): string[] {
  return selected === null ? all : all.filter((id) => selected.includes(id));
}

export function usePrune(options: UsePruneOptions) {
  const supported = ref<boolean | null>(null);
  const params = ref<PruneParams>(emptyParams());
  const saved = ref<PruneParams>(emptyParams());
  const dimensions = ref<PruneDimensions["dimensions"]>([]);
  const progress = ref<PruneScanProgress | null>(null);
  const cancelling = ref(false);
  /** The chunk shown in the inspector, with what the setup suite read from it. */
  const inspected = ref<{ dimension: string; cx: number; cz: number; info: PruneChunkInfo | null; loading: boolean } | null>(null);
  const unfinishedApply = ref<PruneEngineStatus["unfinishedApply"] | null>(null);
  const loadingSettings = ref(false);
  const savingSettings = ref(false);

  const scanning = ref(false);
  const summary = ref<PruneSummary | null>(null);
  /** The parameters the shown summary was made with; differs from `params` once they are edited. */
  const scannedWith = ref<string | null>(null);
  const maps = ref<Record<number, DecodedMap>>({});
  const loadingMap = ref(false);
  /** Loads in flight by dimension index, so a second request for the same map joins the first. */
  const mapLoads = new Map<number, Promise<DecodedMap | null>>();
  const starting = ref(false);

  const inspections = latest();

  let jobId: string | null = null;
  let generation = 0;

  const poller = usePolledJob<PruneScanJob>({
    intervalMs: PRUNE_POLL_MS,
    visibility: options.visibility,
    poll: () => options.api.poll(jobId as string),
    onUpdate: (next) => {
      if (next.state === "running") progress.value = next.progress ?? progress.value;
    },
    isDone: (next) => next.state !== "running",
    onDone: (next) => {
      scanning.value = false;
      cancelling.value = false;
      progress.value = null;
      jobId = null;
      if (next.state === "done" && next.result) {
        summary.value = next.result;
        maps.value = {};
        dropMapLoads();
      } else if (next.error !== "cancelled") {
        options.onError(next.error ? `The scan failed (${next.error}).` : "The scan failed.");
      }
    },
    onError: (err) => {
      scanning.value = false;
      jobId = null;
      options.onError(errorMessage(err, "Could not read the scan."));
    },
  });

  const key = (p: PruneParams): string => JSON.stringify(p);
  /** A manual selection belongs to one scan, not to the saved defaults. */
  const settingsKey = (p: PruneParams): string => JSON.stringify({ ...p, selection: undefined });
  const dirty = computed(() => settingsKey(params.value) !== settingsKey(saved.value));
  /** The summary describes the parameters now on screen. */
  const summaryCurrent = computed(() => summary.value !== null && scannedWith.value === key(params.value));
  const hasDeletions = computed(() => (summary.value?.totals.delete ?? 0) > 0);

  async function loadSupport(): Promise<void> {
    try {
      supported.value = (await options.api.support()).supported;
    } catch (err) {
      supported.value = false;
      options.onError(errorMessage(err, "Could not check whether this server can prune chunks."));
    }
  }

  async function loadDimensions(): Promise<void> {
    if (!options.api.dimensions) return;
    try {
      dimensions.value = (await options.api.dimensions()).dimensions;
    } catch (err) {
      options.onError(errorMessage(err, "Could not list the dimensions."));
    }
  }

  async function loadStatus(): Promise<void> {
    if (!options.api.status) return;
    try {
      unfinishedApply.value = (await options.api.status()).unfinishedApply ?? null;
    } catch {
      // Advisory only: the page works without it.
      unfinishedApply.value = null;
    }
  }

  /** The dimensions the next scan will read. */
  const selectedDimensions = computed(() =>
    dimensionChoice(
      dimensions.value.map((d) => d.id),
      params.value.dimensions,
    ),
  );

  /** Choose the dimensions to scan in one go; an empty choice is ignored, and all of them is stored as null. */
  function setDimensions(ids: readonly string[]): void {
    const all = dimensions.value.map((d) => d.id);
    const chosen = all.filter((id) => ids.includes(id));
    if (chosen.length === 0) return;
    params.value = { ...params.value, dimensions: chosen.length === all.length ? null : chosen };
  }

  /** Include or leave out one dimension; at least one stays, and all of them is stored as null. */
  function setDimension(id: string, on: boolean): void {
    const all = dimensions.value.map((d) => d.id);
    const next = new Set(selectedDimensions.value);
    if (on) next.add(id);
    else if (next.size > 1) next.delete(id);
    const chosen = all.filter((d) => next.has(d));
    params.value = { ...params.value, dimensions: chosen.length === all.length ? null : chosen };
  }

  /** The chunks chosen by hand, sent with the next scan; changing it makes the shown preview stale. */
  function setSelection(selection: NonNullable<PruneParams["selection"]>): void {
    params.value = { ...params.value, selection };
  }

  async function inspect(dimension: string, cx: number, cz: number): Promise<void> {
    const plan = summary.value?.id;
    if (!plan || !options.api.chunk) return;
    const mine = generation;
    const isLatest = inspections.begin();
    inspected.value = { dimension, cx, cz, info: null, loading: true };
    try {
      const info = await options.api.chunk(plan, dimension, cx, cz);
      if (mine !== generation || !isLatest()) return;
      inspected.value = { dimension, cx, cz, info, loading: false };
    } catch (err) {
      if (mine !== generation || !isLatest()) return;
      inspected.value = null;
      options.onError(errorMessage(err, "Could not read that chunk."));
    }
  }

  function clearInspection(): void {
    inspections.cancel();
    inspected.value = null;
  }

  async function cancelScan(): Promise<void> {
    if (!jobId || !scanning.value || cancelling.value || !options.api.cancel) return;
    cancelling.value = true;
    try {
      await options.api.cancel(jobId);
    } catch (err) {
      cancelling.value = false;
      options.onError(errorMessage(err, "Could not stop the scan."));
    }
  }

  async function loadSettings(): Promise<void> {
    loadingSettings.value = true;
    try {
      const loaded = await options.api.settings();
      params.value = structuredCloneParams(loaded);
      saved.value = structuredCloneParams(loaded);
    } catch (err) {
      options.onError(errorMessage(err, "Could not load the saved settings."));
    } finally {
      loadingSettings.value = false;
    }
  }

  async function saveSettings(): Promise<boolean> {
    savingSettings.value = true;
    try {
      const selection = params.value.selection;
      const stored = await options.api.save({ ...params.value, selection: undefined });
      params.value = { ...structuredCloneParams(stored), ...(selection ? { selection } : {}) };
      saved.value = structuredCloneParams(stored);
      return true;
    } catch (err) {
      options.onError(errorMessage(err, "Could not save the settings."));
      return false;
    } finally {
      savingSettings.value = false;
    }
  }

  async function scan(): Promise<void> {
    if (scanning.value) return;
    generation++;
    const mine = generation;
    poller.stop();
    scanning.value = true;
    inspected.value = null;
    progress.value = null;
    cancelling.value = false;
    summary.value = null;
    maps.value = {};
    dropMapLoads();
    const used = key(params.value);
    try {
      const started = await options.api.scan(params.value);
      if (mine !== generation) return;
      jobId = started.jobId;
      scannedWith.value = used;
      await poller.start({ immediate: true });
    } catch (err) {
      if (mine !== generation) return;
      scanning.value = false;
      jobId = null;
      options.onError(errorMessage(err, "Could not start the scan."));
    }
  }

  /** Forget loads that belong to a plan no longer shown; their results are discarded on arrival. */
  function dropMapLoads(): void {
    mapLoads.clear();
    loadingMap.value = false;
  }

  async function fetchMap(plan: string, index: number, mine: number): Promise<DecodedMap | null> {
    try {
      const decoded = decodeMap(await options.api.map(plan, index));
      // A newer scan or a reset replaced the plan while this was in flight.
      if (mine !== generation) return null;
      maps.value = { ...maps.value, [index]: decoded };
      return decoded;
    } catch (err) {
      if (mine === generation) options.onError(errorMessage(err, "Could not load the map."));
      return null;
    }
  }

  function loadMap(index: number): Promise<DecodedMap | null> {
    const cached = maps.value[index];
    if (cached) return Promise.resolve(cached);
    const plan = summary.value?.id;
    if (!plan) return Promise.resolve(null);
    const running = mapLoads.get(index);
    if (running) return running;

    const mine = generation;
    loadingMap.value = true;
    const load: Promise<DecodedMap | null> = fetchMap(plan, index, mine).finally(() => {
      if (mapLoads.get(index) === load) {
        mapLoads.delete(index);
        loadingMap.value = mapLoads.size > 0;
      }
    });
    mapLoads.set(index, load);
    return load;
  }

  /** Start the delete for the shown summary. Returns the job id to follow, or null. */
  async function apply(countdownSeconds: number): Promise<string | null> {
    const plan = summary.value?.id;
    if (!plan || !summaryCurrent.value || starting.value) return null;
    starting.value = true;
    try {
      return (await options.api.apply(plan, countdownSeconds)).jobId;
    } catch (err) {
      options.onError(errorMessage(err, "Could not start the prune."));
      return null;
    } finally {
      starting.value = false;
    }
  }

  function addZone(zone: PruneZone): void {
    params.value = { ...params.value, zones: [...params.value.zones, zone] };
  }

  function removeZone(index: number): void {
    params.value = { ...params.value, zones: params.value.zones.filter((_, i) => i !== index) };
  }

  function reset(): void {
    generation++;
    poller.stop();
    jobId = null;
    scanning.value = false;
    summary.value = null;
    scannedWith.value = null;
    maps.value = {};
    dropMapLoads();
    supported.value = null;
    progress.value = null;
    cancelling.value = false;
    inspected.value = null;
    dimensions.value = [];
    unfinishedApply.value = null;
    params.value = emptyParams();
    saved.value = emptyParams();
  }

  function dispose(): void {
    reset();
    poller.dispose();
  }

  return {
    supported,
    params,
    saved,
    dirty,
    loadingSettings,
    savingSettings,
    scanning,
    summary,
    summaryCurrent,
    hasDeletions,
    maps,
    loadingMap,
    starting,
    dimensions,
    selectedDimensions,
    setDimension,
    setDimensions,
    setSelection,
    progress,
    cancelling,
    cancelScan,
    inspected,
    inspect,
    clearInspection,
    unfinishedApply,
    loadDimensions,
    loadStatus,
    loadSupport,
    loadSettings,
    saveSettings,
    scan,
    loadMap,
    apply,
    addZone,
    removeZone,
    reset,
    dispose,
  };
}

function structuredCloneParams(p: PruneParams): PruneParams {
  return { ...p, zones: p.zones.map((z) => ({ ...z })), dimensions: p.dimensions ? [...p.dimensions] : null };
}
