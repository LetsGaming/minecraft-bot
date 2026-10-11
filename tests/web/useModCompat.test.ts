import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  useModCompat,
  POLL_INTERVAL_MS,
  MC_VERSION_RE,
  type ModCompatApi,
  type PageVisibility,
} from "../../src/web/frontend/src/composables/useModCompat.js";
import type { ModCompatJob } from "../../src/web/frontend/src/api.js";

function job(partial: Partial<ModCompatJob> = {}): ModCompatJob {
  return {
    jobId: "j1",
    state: "running",
    mcVersion: "1.21.5",
    modLoader: "fabric",
    progress: { done: 0, total: 3 },
    partial: [],
    ...partial,
  };
}

const done: ModCompatJob = job({
  state: "done",
  progress: { done: 3, total: 3 },
  checkedAt: 1,
  complete: false,
  summary: { available: 1, unavailable: 1, unknown: 1, total: 3 },
  mods: [
    { slug: "a", availability: "available" },
    { slug: "b", availability: "unavailable", reason: "no compatible release" },
    { slug: "c", availability: "unknown", reason: "timeout" },
  ],
});

function setup(overrides: Partial<ModCompatApi> = {}, visibility?: PageVisibility) {
  const api: ModCompatApi = {
    start: vi.fn(async () => ({ jobId: "j1" })),
    poll: vi.fn(async () => done),
    versions: vi.fn(async () => ({ versions: ["1.21.5", "1.21.4", "1.20.1"] })),
    ...overrides,
  };
  const onError = vi.fn();
  const compat = useModCompat({
    api,
    installedVersion: () => "1.21.4",
    onError,
    visibility,
  });
  return { api, onError, compat };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("version choices", () => {
  it("lists the installed version first, then releases without repeating it", async () => {
    const { compat } = setup();
    await compat.loadVersions();
    expect(compat.versionChoices.value).toEqual(["1.21.4", "1.21.5", "1.20.1"]);
    expect(compat.selected.value).toBe("1.21.4");
    expect(compat.useCustom.value).toBe(false);
  });

  it("falls back to free text and reports the error when Mojang cannot be read", async () => {
    const { compat, onError } = setup({
      versions: vi.fn(async () => {
        throw new Error("Mojang down");
      }),
    });
    await compat.loadVersions();
    expect(compat.useCustom.value).toBe(true);
    expect(onError).toHaveBeenCalledWith("Mojang down");
  });

  it("validates a typed version with the wrapper's pattern", async () => {
    const { compat, onError, api } = setup();
    compat.useCustom.value = true;
    for (const bad of ["", "1 21", "../x", "a".repeat(21)]) {
      compat.customVersion.value = bad;
      expect(compat.targetValid.value).toBe(false);
      await compat.check();
    }
    expect(api.start).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(4);
    compat.customVersion.value = " 1.21.5 ";
    expect(compat.targetValid.value).toBe(true);
    expect(MC_VERSION_RE.test("1.21.5")).toBe(true);
  });
});

describe("polling", () => {
  it("shows 'Checking N of M' and polls until the job is done", async () => {
    const polls = [
      job({ progress: { done: 13, total: 62 } }),
      job({ progress: { done: 40, total: 62 } }),
      done,
    ];
    const { compat, api } = setup({ poll: vi.fn(async () => polls.shift()!) });
    compat.selected.value = "1.21.5";

    await compat.check();
    expect(compat.checkingCompat.value).toBe(true);
    expect(compat.progressText.value).toBe("Checking 14 of 62");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(compat.progressText.value).toBe("Checking 41 of 62");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(compat.checkingCompat.value).toBe(false);
    expect(compat.hasResult.value).toBe(true);
    expect(compat.summaryText.value).toBe("1 ready, 1 missing, 1 unknown");

    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(api.poll).toHaveBeenCalledTimes(3);
  });

  it("stops and reports a failed job", async () => {
    const { compat, onError, api } = setup({
      poll: vi.fn(async () => job({ state: "failed", error: "script failed" })),
    });
    compat.selected.value = "1.21.5";
    await compat.check();
    expect(compat.checkingCompat.value).toBe(false);
    expect(compat.failed.value).toBe(true);
    expect(onError).toHaveBeenCalledWith("script failed");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(api.poll).toHaveBeenCalledTimes(1);
  });

  it("reports a failed start without polling", async () => {
    const { compat, onError, api } = setup({
      start: vi.fn(async () => {
        throw new Error("This server's API wrapper cannot check another Minecraft version.");
      }),
    });
    compat.selected.value = "1.21.5";
    await compat.check();
    expect(compat.checkingCompat.value).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      "This server's API wrapper cannot check another Minecraft version.",
    );
    expect(api.poll).not.toHaveBeenCalled();
  });

  it("reports a poll error (for example an expired job) and stops", async () => {
    const { compat, onError, api } = setup({
      poll: vi.fn(async () => {
        throw new Error("This check expired. Start it again.");
      }),
    });
    compat.selected.value = "1.21.5";
    await compat.check();
    expect(compat.checkingCompat.value).toBe(false);
    expect(onError).toHaveBeenCalledWith("This check expired. Start it again.");
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    expect(api.poll).toHaveBeenCalledTimes(1);
  });

  it("does not poll while the tab is hidden and resumes when it returns", async () => {
    let hidden = false;
    let wake: () => void = () => undefined;
    const visibility: PageVisibility = {
      isHidden: () => hidden,
      onVisible(cb) {
        wake = cb;
        return () => undefined;
      },
    };
    const polls = [job({ progress: { done: 1, total: 3 } }), done];
    const { compat, api } = setup({ poll: vi.fn(async () => polls.shift()!) }, visibility);
    compat.selected.value = "1.21.5";

    await compat.check();
    hidden = true;
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 4);
    expect(api.poll).toHaveBeenCalledTimes(1);

    hidden = false;
    wake();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    expect(api.poll).toHaveBeenCalledTimes(2);
    expect(compat.hasResult.value).toBe(true);
  });

  it("dispose and reset stop the poll and drop the result", async () => {
    const { compat, api } = setup({ poll: vi.fn(async () => job()) });
    compat.selected.value = "1.21.5";
    await compat.check();
    compat.dispose();
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 5);
    expect(api.poll).toHaveBeenCalledTimes(1);
    expect(compat.checkingCompat.value).toBe(false);
    expect(compat.job.value).toBeNull();
  });

  it("a server switch mid-check ignores the old job's late answer", async () => {
    let release: (j: ModCompatJob) => void = () => undefined;
    const { compat } = setup({
      poll: vi.fn(
        () =>
          new Promise<ModCompatJob>((resolve) => {
            release = resolve;
          }),
      ),
    });
    compat.selected.value = "1.21.5";
    const pending = compat.check();
    await Promise.resolve();
    compat.reset();
    release(done);
    await pending;
    expect(compat.job.value).toBeNull();
    expect(compat.hasResult.value).toBe(false);
  });
});

describe("results", () => {
  async function finished() {
    const ctx = setup();
    ctx.compat.selected.value = "1.21.5";
    await ctx.compat.check();
    return ctx.compat;
  }

  it("flags blockers as anything not available", async () => {
    const compat = await finished();
    expect(compat.isBlocker("a")).toBe(false);
    expect(compat.isBlocker("b")).toBe(true);
    expect(compat.isBlocker("c")).toBe(true);
    expect(compat.isBlocker("unchecked")).toBe(false);
    expect(compat.forSlug("c")?.reason).toBe("timeout");
  });

  it("marks a finished result stale when the installed set changes", async () => {
    const compat = await finished();
    expect(compat.stale.value).toBe(false);
    compat.markStale();
    expect(compat.stale.value).toBe(true);
  });

  it("an empty mod set is its own state", async () => {
    const { compat } = setup({
      poll: vi.fn(async () =>
        job({
          state: "done",
          summary: { available: 0, unavailable: 0, unknown: 0, total: 0 },
          mods: [],
        }),
      ),
    });
    compat.selected.value = "1.21.5";
    await compat.check();
    expect(compat.emptyResult.value).toBe(true);
  });

  it("uses partial results while running", async () => {
    const { compat } = setup({
      poll: vi.fn(async () =>
        job({ partial: [{ slug: "a", availability: "available" }] }),
      ),
    });
    compat.selected.value = "1.21.5";
    await compat.check();
    expect(compat.forSlug("a")?.availability).toBe("available");
    expect(compat.summaryText.value).toBe("");
  });

  it("summarises a finished check with unknown counted on its own", async () => {
    const compat = await finished();
    expect(compat.summary.value).toEqual({ available: 1, unavailable: 1, unknown: 1, total: 3 });
    expect(compat.rows.value.map((m) => m.slug)).toEqual(["a", "b", "c"]);
    expect(compat.checkedVersion.value).toBe("1.21.5");
  });

  it("a second check while one runs starts nothing", async () => {
    const { compat, api } = setup({ poll: vi.fn(async () => job()) });
    compat.selected.value = "1.21.5";
    await compat.check();
    await compat.check(true);
    expect(api.start).toHaveBeenCalledTimes(1);
    compat.dispose();
  });

  it("a new check clears the stale mark and reset forgets version and filter", async () => {
    const compat = await finished();
    compat.markStale();
    compat.filter.value = "blockers";
    await compat.check();
    expect(compat.stale.value).toBe(false);
    compat.reset();
    expect(compat.checkedVersion.value).toBeNull();
    expect(compat.filter.value).toBe("all");
    expect(compat.rows.value).toEqual([]);
  });
});
