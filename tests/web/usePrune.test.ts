import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  usePrune,
  decodeMap,
  parseRegionFile,
  emptyParams,
  PRUNE_POLL_MS,
  CELL,
  type PruneApi,
  type PageVisibility,
} from "../../src/web/frontend/src/composables/usePrune.js";
import type { PruneScanJob, PruneSummary } from "../../src/schema/wire/index.js";

const SUMMARY = {
  ok: true,
  id: "0123456789abcdef",
  createdAt: "2026-10-12T00:00:00.000Z",
  params: emptyParams(),
  warnings: [],
  totals: { chunks: 100, delete: 40, regions: 2, regionsEmptied: 0, bytes: 5 * 1024 * 1024 },
  dimensions: [],
} as PruneSummary;

const b64 = (bytes: number[]): string => btoa(String.fromCharCode(...bytes));

function setup(overrides: Partial<PruneApi> = {}, visibility?: PageVisibility) {
  const api: PruneApi = {
    support: vi.fn(async () => ({ supported: true })),
    settings: vi.fn(async () => emptyParams()),
    save: vi.fn(async (p) => ({ ...emptyParams(), ...p }) as never),
    scan: vi.fn(async () => ({ jobId: "j1" })),
    poll: vi.fn(async () => ({ jobId: "j1", state: "done", result: SUMMARY }) as PruneScanJob),
    map: vi.fn(async () => ({ dimension: "overworld", regions: { "r.0.0": { cell: b64([0, 1, 2]), heat: b64([0, 5, 9]) } } }) as never),
    apply: vi.fn(async () => ({ jobId: "job-9" })),
    ...overrides,
  };
  const onError = vi.fn();
  return { api, onError, prune: usePrune({ api, onError, visibility }) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("settings", () => {
  it("loads, tracks edits and saves", async () => {
    const { prune, api } = setup({ settings: vi.fn(async () => ({ ...emptyParams(), thresholdMinutes: 7 })) });
    await prune.loadSettings();
    expect(prune.params.value.thresholdMinutes).toBe(7);
    expect(prune.dirty.value).toBe(false);

    prune.params.value = { ...prune.params.value, thresholdMinutes: 20 };
    expect(prune.dirty.value).toBe(true);
    expect(await prune.saveSettings()).toBe(true);
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ thresholdMinutes: 20 }));
    expect(prune.dirty.value).toBe(false);
  });

  it("reports a failed load or save", async () => {
    const { prune, onError } = setup({
      settings: vi.fn(async () => { throw new Error("down"); }),
      save: vi.fn(async () => { throw new Error("refused"); }),
    });
    await prune.loadSettings();
    expect(onError).toHaveBeenCalledWith("down");
    expect(await prune.saveSettings()).toBe(false);
    expect(onError).toHaveBeenCalledWith("refused");
  });

  it("support is read from the backend and a failure counts as unsupported", async () => {
    const a = setup({ support: vi.fn(async () => ({ supported: false })) });
    await a.prune.loadSupport();
    expect(a.prune.supported.value).toBe(false);
    const b = setup({ support: vi.fn(async () => { throw new Error("x"); }) });
    await b.prune.loadSupport();
    expect(b.prune.supported.value).toBe(false);
    expect(b.onError).toHaveBeenCalled();
  });
});

describe("zones", () => {
  it("adds and removes", () => {
    const { prune } = setup();
    prune.addZone({ name: "base", dimension: "overworld", x1: 0, z1: 0, x2: 5, z2: 5 });
    prune.addZone({ name: "farm", dimension: "overworld", x1: 9, z1: 9, x2: 9, z2: 9 });
    expect(prune.params.value.zones.map((z) => z.name)).toEqual(["base", "farm"]);
    prune.removeZone(0);
    expect(prune.params.value.zones.map((z) => z.name)).toEqual(["farm"]);
    expect(prune.dirty.value).toBe(true);
  });
});

describe("scanning", () => {
  it("scans with the screen's parameters and shows the summary", async () => {
    const { prune, api } = setup();
    prune.params.value = { ...prune.params.value, thresholdMinutes: 30 };
    await prune.scan();
    expect(api.scan).toHaveBeenCalledWith(expect.objectContaining({ thresholdMinutes: 30 }));
    expect(prune.summary.value?.id).toBe(SUMMARY.id);
    expect(prune.scanning.value).toBe(false);
    expect(prune.summaryCurrent.value).toBe(true);
    expect(prune.hasDeletions.value).toBe(true);
  });

  it("polls a running scan until it ends", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ jobId: "j1", state: "running" })
      .mockResolvedValueOnce({ jobId: "j1", state: "done", result: SUMMARY });
    const { prune } = setup({ poll });
    await prune.scan();
    expect(prune.scanning.value).toBe(true);
    await vi.advanceTimersByTimeAsync(PRUNE_POLL_MS);
    expect(prune.summary.value).not.toBeNull();
    expect(prune.scanning.value).toBe(false);
  });

  it("a summary stops being current once the parameters change", async () => {
    const { prune } = setup();
    await prune.scan();
    expect(prune.summaryCurrent.value).toBe(true);
    prune.params.value = { ...prune.params.value, bufferChunks: 9 };
    expect(prune.summaryCurrent.value).toBe(false);
  });

  it("reports a failed scan by its reason code and keeps no summary", async () => {
    const { prune, onError } = setup({ poll: vi.fn(async () => ({ jobId: "j1", state: "failed", error: "scan_failed" }) as PruneScanJob) });
    await prune.scan();
    expect(onError).toHaveBeenCalledWith("The scan failed (scan_failed).");
    expect(prune.summary.value).toBeNull();
    expect(prune.scanning.value).toBe(false);
  });

  it("reports a scan that cannot start", async () => {
    const { prune, onError } = setup({ scan: vi.fn(async () => { throw new Error("A scan is already running."); }) });
    await prune.scan();
    expect(onError).toHaveBeenCalledWith("A scan is already running.");
    expect(prune.scanning.value).toBe(false);
  });

  it("does not poll while the tab is hidden and resumes when it returns", async () => {
    let hidden = true;
    let resume: () => void = () => {};
    const visibility: PageVisibility = { isHidden: () => hidden, onVisible: (cb) => { resume = cb; return () => undefined; } };
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ jobId: "j1", state: "running" })
      .mockResolvedValue({ jobId: "j1", state: "done", result: SUMMARY });
    const { prune, api } = setup({ poll }, visibility);
    hidden = false;
    await prune.scan();
    hidden = true;
    await vi.advanceTimersByTimeAsync(PRUNE_POLL_MS * 3);
    expect(api.poll).toHaveBeenCalledTimes(1);
    hidden = false;
    resume();
    await vi.advanceTimersByTimeAsync(PRUNE_POLL_MS);
    expect(prune.summary.value).not.toBeNull();
  });

  it("a reset drops a scan in flight", async () => {
    let release: (j: PruneScanJob) => void = () => {};
    const poll = vi.fn(() => new Promise<PruneScanJob>((r) => (release = r)));
    const { prune } = setup({ poll });
    const pending = prune.scan();
    await vi.advanceTimersByTimeAsync(0);
    prune.reset();
    release({ jobId: "j1", state: "done", result: SUMMARY });
    await pending;
    expect(prune.summary.value).toBeNull();
  });
});

describe("maps", () => {
  it("decodes one dimension once and caches it", async () => {
    const { prune, api } = setup();
    await prune.scan();
    const first = await prune.loadMap(0);
    expect(first?.regions[0]).toMatchObject({ rx: 0, rz: 0 });
    expect([...first!.regions[0]!.cell.subarray(0, 3)]).toEqual([CELL.EMPTY, CELL.DELETE, CELL.ACTIVE]);
    await prune.loadMap(0);
    expect(api.map).toHaveBeenCalledTimes(1);
  });

  it("joins a load already in flight instead of requesting the map twice", async () => {
    const { prune, api } = setup();
    await prune.scan();
    const [a, b] = await Promise.all([prune.loadMap(0), prune.loadMap(0)]);
    expect(a).toBe(b);
    expect(api.map).toHaveBeenCalledTimes(1);
    expect(prune.loadingMap.value).toBe(false);
  });

  it("drops a map that arrives after a newer scan started", async () => {
    let release: (v: never) => void = () => undefined;
    const slow = vi.fn(() => new Promise<never>((resolve) => { release = resolve; }));
    const { prune, onError } = setup({ map: slow });
    await prune.scan();
    const stale = prune.loadMap(0);
    await prune.scan();
    release({ dimension: "overworld", regions: { "r.0.0": { cell: b64([1]), heat: b64([1]) } } } as never);
    expect(await stale).toBeNull();
    expect(prune.maps.value[0]).toBeUndefined();
    expect(onError).not.toHaveBeenCalled();
  });

  it("is null without a scan, and reports a failed load", async () => {
    const none = setup();
    expect(await none.prune.loadMap(0)).toBeNull();
    const bad = setup({ map: vi.fn(async () => { throw new Error("expired"); }) });
    await bad.prune.scan();
    expect(await bad.prune.loadMap(0)).toBeNull();
    expect(bad.onError).toHaveBeenCalledWith("expired");
  });

  it("decodeMap computes the bounds and skips malformed entries", () => {
    const m = decodeMap({
      dimension: "overworld",
      regions: {
        "r.-1.0": { cell: b64([1]), heat: b64([2]) },
        "r.3.2": { cell: b64([1]), heat: b64([2]) },
        nope: { cell: "x", heat: "y" },
        "r.0.0": { cell: 5 },
      },
    } as never);
    expect(m.regions).toHaveLength(2);
    expect(m.bounds).toEqual({ minX: -1, minZ: 0, maxX: 3, maxZ: 2 });
    expect(parseRegionFile("r.-4.7")).toEqual({ rx: -4, rz: 7 });
    expect(parseRegionFile("r.1")).toBeNull();
  });
});

describe("apply", () => {
  it("starts the delete for the shown summary and returns the job to follow", async () => {
    const { prune, api } = setup();
    await prune.scan();
    expect(await prune.apply(45)).toBe("job-9");
    expect(api.apply).toHaveBeenCalledWith(SUMMARY.id, 45);
  });

  it("refuses without a scan, or after the parameters changed", async () => {
    const { prune, api } = setup();
    expect(await prune.apply(30)).toBeNull();
    await prune.scan();
    prune.params.value = { ...prune.params.value, bufferChunks: 5 };
    expect(await prune.apply(30)).toBeNull();
    expect(api.apply).not.toHaveBeenCalled();
  });

  it("reports a refused start", async () => {
    const { prune, onError } = setup({ apply: vi.fn(async () => { throw new Error("The server is busy (backup)."); }) });
    await prune.scan();
    expect(await prune.apply(30)).toBeNull();
    expect(onError).toHaveBeenCalledWith("The server is busy (backup).");
    expect(prune.starting.value).toBe(false);
  });
});

describe("dimensions, progress and cancel", () => {
  const DIMS = { dimensions: [{ id: "overworld", regions: 900 }, { id: "the_nether", regions: 40 }, { id: "the_end", regions: 5 }] };

  it("treats no selection as every dimension and stores all of them as null", async () => {
    const { prune } = setup({ dimensions: vi.fn(async () => DIMS) });
    await prune.loadDimensions();
    expect(prune.selectedDimensions.value).toEqual(["overworld", "the_nether", "the_end"]);

    prune.setDimension("overworld", false);
    prune.setDimension("the_end", false);
    expect(prune.params.value.dimensions).toEqual(["the_nether"]);
    expect(prune.selectedDimensions.value).toEqual(["the_nether"]);

    prune.setDimension("overworld", true);
    prune.setDimension("the_end", true);
    expect(prune.params.value.dimensions).toBeNull();
  });

  it("never lets the last dimension be switched off", async () => {
    const { prune } = setup({ dimensions: vi.fn(async () => DIMS) });
    await prune.loadDimensions();
    prune.setDimension("overworld", false);
    prune.setDimension("the_nether", false);
    prune.setDimension("the_end", false);
    expect(prune.selectedDimensions.value).toEqual(["the_end"]);
  });

  it("sends the chosen dimensions with the scan and marks a changed choice as stale", async () => {
    const { prune, api } = setup({ dimensions: vi.fn(async () => DIMS) });
    await prune.loadDimensions();
    prune.setDimension("overworld", false);
    await prune.scan();
    expect(api.scan).toHaveBeenCalledWith(expect.objectContaining({ dimensions: ["the_nether", "the_end"] }));
    expect(prune.summaryCurrent.value).toBe(true);
    prune.setDimension("overworld", true);
    expect(prune.summaryCurrent.value).toBe(false);
  });

  it("shows the latest progress while scanning and clears it at the end", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ jobId: "j1", state: "running", progress: { done: 2, total: 9, chunks: 2000, chunksPerSecond: 900, etaSeconds: 7 } })
      .mockResolvedValueOnce({ jobId: "j1", state: "done", result: SUMMARY });
    const { prune } = setup({ poll });
    await prune.scan();
    expect(prune.progress.value).toMatchObject({ done: 2, total: 9 });
    await vi.advanceTimersByTimeAsync(PRUNE_POLL_MS);
    expect(prune.progress.value).toBeNull();
    expect(prune.scanning.value).toBe(false);
  });

  it("cancels a scan without reporting an error", async () => {
    const cancel = vi.fn(async () => ({ cancelled: true }));
    const poll = vi
      .fn()
      .mockResolvedValueOnce({ jobId: "j1", state: "running" })
      .mockResolvedValueOnce({ jobId: "j1", state: "failed", error: "cancelled" });
    const { prune, onError } = setup({ poll, cancel });
    await prune.scan();
    await prune.cancelScan();
    expect(cancel).toHaveBeenCalledWith("j1");
    expect(prune.cancelling.value).toBe(true);
    await vi.advanceTimersByTimeAsync(PRUNE_POLL_MS);
    expect(prune.scanning.value).toBe(false);
    expect(prune.cancelling.value).toBe(false);
    expect(onError).not.toHaveBeenCalled();
    expect(prune.summary.value).toBeNull();
  });

  it("reports an unfinished delete from the engine status, and ignores a failed status call", async () => {
    const status = vi.fn(async () => ({ engine: "builtin", version: 1, unfinishedApply: { state: "applying" as const, plan: "0123456789abcdef", startedAt: "2026-10-13T10:00:00Z" } }));
    const { prune } = setup({ status });
    await prune.loadStatus();
    expect(prune.unfinishedApply.value).toMatchObject({ state: "applying" });
    const broken = setup({ status: vi.fn(async () => { throw new Error("x"); }) });
    await broken.prune.loadStatus();
    expect(broken.prune.unfinishedApply.value).toBeNull();
    expect(broken.onError).not.toHaveBeenCalled();
  });
});

describe("inspecting a chunk", () => {
  const INFO = { chunk: { dimension: "overworld", cx: 3, cz: -2, rx: 0, rz: -1, slot: 931 }, thresholdMinutes: 5, present: true, readable: true };

  it("reads the chunk of the shown plan and keeps the answer for that chunk only", async () => {
    const chunk = vi.fn(async () => INFO);
    const { prune } = setup({ chunk });
    await prune.scan();
    await prune.inspect("overworld", 3, -2);
    expect(chunk).toHaveBeenCalledWith(SUMMARY.id, "overworld", 3, -2);
    expect(prune.inspected.value).toMatchObject({ cx: 3, cz: -2, loading: false, info: { present: true } });
    prune.clearInspection();
    expect(prune.inspected.value).toBeNull();
  });

  it("drops a slow answer for a chunk the user has moved on from", async () => {
    let release: (v: unknown) => void = () => undefined;
    const chunk = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }))
      .mockResolvedValueOnce({ ...INFO, chunk: { ...INFO.chunk, cx: 9 } });
    const { prune } = setup({ chunk });
    await prune.scan();
    const first = prune.inspect("overworld", 3, -2);
    await prune.inspect("overworld", 9, -2);
    release(INFO);
    await first;
    expect(prune.inspected.value).toMatchObject({ cx: 9 });
  });

  it("does nothing without a scan, and a new scan closes the inspector", async () => {
    const chunk = vi.fn(async () => INFO);
    const { prune } = setup({ chunk });
    await prune.inspect("overworld", 0, 0);
    expect(chunk).not.toHaveBeenCalled();
    await prune.scan();
    await prune.inspect("overworld", 0, 0);
    await prune.scan();
    expect(prune.inspected.value).toBeNull();
  });

  it("reports a failed read and closes the inspector", async () => {
    const { prune, onError } = setup({ chunk: vi.fn(async () => { throw new Error("gone"); }) });
    await prune.scan();
    await prune.inspect("overworld", 0, 0);
    expect(onError).toHaveBeenCalledWith("gone");
    expect(prune.inspected.value).toBeNull();
  });
});

describe("choosing dimensions together", () => {
  const DIMS = { dimensions: [{ id: "overworld", regions: 900 }, { id: "the_nether", regions: 40 }, { id: "the_end", regions: 5 }] };

  it("takes a whole choice at once, keeps the world's order, and stores all of them as null", async () => {
    const { prune } = setup({ dimensions: vi.fn(async () => DIMS) });
    await prune.loadDimensions();
    prune.setDimensions(["the_end", "overworld"]);
    expect(prune.params.value.dimensions).toEqual(["overworld", "the_end"]);
    prune.setDimensions(["the_nether", "the_end", "overworld"]);
    expect(prune.params.value.dimensions).toBeNull();
  });

  it("ignores an empty choice and unknown names", async () => {
    const { prune } = setup({ dimensions: vi.fn(async () => DIMS) });
    await prune.loadDimensions();
    prune.setDimensions(["the_nether"]);
    prune.setDimensions([]);
    prune.setDimensions(["nowhere"]);
    expect(prune.params.value.dimensions).toEqual(["the_nether"]);
  });
});
