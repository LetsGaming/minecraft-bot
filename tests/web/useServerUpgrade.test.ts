import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  useServerUpgrade,
  phaseRows,
  UPGRADE_POLL_MS,
  RECENT_RESULT_SECONDS,
  type UpgradeApi,
  type PageVisibility,
} from "../../src/web/frontend/src/composables/useServerUpgrade.js";
import type { UpgradeJob } from "../../src/schema/wire/index.js";

const NOW = 1_800_000_000;
const ev = (seq: number, phase: string, status: string, msg = "", ts = NOW - 5) => ({ seq, ts, phase, status, msg });

function job(partial: Partial<UpgradeJob> = {}): UpgradeJob {
  return { jobId: "j1", state: "running", mcVersion: "1.21.5", events: [], next: 0, ...partial } as UpgradeJob;
}

function setup(overrides: Partial<UpgradeApi> = {}, visibility?: PageVisibility) {
  const api: UpgradeApi = {
    support: vi.fn(async () => ({ supported: true })),
    start: vi.fn(async () => ({ jobId: "j1" })),
    poll: vi.fn(async () => job({ state: "done", result: { ok: true }, events: [ev(1, "start", "done")], next: 1 })),
    current: vi.fn(async () => null),
    ...overrides,
  };
  const onError = vi.fn();
  const upgrade = useServerUpgrade({ api, onError, visibility, nowSeconds: () => NOW });
  return { api, onError, upgrade };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("phaseRows", () => {
  it("keeps the latest status per phase and treats sub-steps as running", () => {
    const rows = phaseRows([
      ev(1, "plan", "running"),
      ev(2, "plan", "done"),
      ev(3, "apply", "running"),
      ev(4, "apply.jar", "done", "Installing"),
    ]);
    expect(rows.map((r) => [r.phase, r.status])).toEqual([
      ["plan", "done"],
      ["apply", "running"],
    ]);
  });

  it("maps an error and unknown statuses", () => {
    expect(phaseRows([ev(1, "stop", "error")])[0]!.status).toBe("error");
    expect(phaseRows([ev(1, "stop", "info")])[0]!.status).toBe("running");
  });
});

describe("support", () => {
  it("reports what the backend says", async () => {
    const { upgrade } = setup({ support: vi.fn(async () => ({ supported: false })) });
    await upgrade.loadSupport();
    expect(upgrade.supported.value).toBe(false);
  });

  it("treats a failed check as unsupported and says so", async () => {
    const { upgrade, onError } = setup({ support: vi.fn(async () => { throw new Error("down"); }) });
    await upgrade.loadSupport();
    expect(upgrade.supported.value).toBe(false);
    expect(onError).toHaveBeenCalledWith("down");
  });
});

describe("starting and following a job", () => {
  it("starts, then polls until it finishes and keeps every event once", async () => {
    const poll = vi
      .fn()
      .mockResolvedValueOnce(job({ events: [ev(1, "plan", "done"), ev(2, "stop", "running")], next: 2 }))
      .mockResolvedValueOnce(job({ state: "done", events: [ev(3, "start", "done")], next: 3, result: { ok: true, branch: "clean" } }));
    const { api, upgrade } = setup({ poll });

    expect(await upgrade.start({ mcVersion: "1.21.5" })).toBe(true);
    expect(upgrade.running.value).toBe(true);

    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(upgrade.events.value.map((e) => e.seq)).toEqual([1, 2]);
    expect(poll).toHaveBeenLastCalledWith("j1", 0);

    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(poll).toHaveBeenLastCalledWith("j1", 2);
    expect(upgrade.events.value.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(upgrade.finished.value).toBe(true);
    expect(upgrade.result.value).toMatchObject({ ok: true });

    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS * 3);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("refuses a second start while one runs", async () => {
    const { api, upgrade } = setup({ poll: vi.fn(async () => job()) });
    await upgrade.start({ mcVersion: "1.21.5" });
    expect(await upgrade.start({ mcVersion: "1.21.5" })).toBe(false);
    expect(api.start).toHaveBeenCalledTimes(1);
  });

  it("reports a refused start and stays idle", async () => {
    const { upgrade, onError } = setup({ start: vi.fn(async () => { throw new Error("The server is busy (backup)."); }) });
    expect(await upgrade.start({ mcVersion: "1.21.5" })).toBe(false);
    expect(onError).toHaveBeenCalledWith("The server is busy (backup).");
    expect(upgrade.job.value).toBeNull();
    expect(upgrade.starting.value).toBe(false);
  });

  it("survives a failed poll and keeps going", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("wrapper restarting"))
      .mockResolvedValueOnce(job({ state: "done", result: { ok: true }, events: [ev(1, "start", "done")], next: 1 }));
    const { upgrade, onError } = setup({ poll });
    await upgrade.start({ mcVersion: "1.21.5" });
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(onError).toHaveBeenCalledWith("wrapper restarting");
    expect(upgrade.running.value).toBe(true);
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(upgrade.finished.value).toBe(true);
  });

  it("does not poll while the tab is hidden and resumes when it returns", async () => {
    let hidden = true;
    let resume: () => void = () => {};
    const visibility: PageVisibility = {
      isHidden: () => hidden,
      onVisible: (cb) => {
        resume = cb;
        return () => undefined;
      },
    };
    const { api, upgrade } = setup({ poll: vi.fn(async () => job()) }, visibility);
    await upgrade.start({ mcVersion: "1.21.5" });
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS * 3);
    expect(api.poll).not.toHaveBeenCalled();
    hidden = false;
    resume();
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(api.poll).toHaveBeenCalledTimes(1);
  });

  it("counts finished steps", async () => {
    const { upgrade } = setup({
      poll: vi.fn(async () => job({ events: [ev(1, "plan", "done"), ev(2, "stop", "done"), ev(3, "backup", "running")], next: 3 })),
    });
    await upgrade.start({ mcVersion: "1.21.5" });
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(upgrade.stepsDone.value).toBe(2);
  });

  it("reaches every step on a prune-only job, whose fifth step is prune", async () => {
    const phases = ["plan", "countdown", "stop", "backup", "prune", "start"];
    const { upgrade } = setup({
      poll: vi.fn(async () =>
        job({ kind: "prune", state: "done", result: { ok: true }, events: phases.map((p, i) => ev(i + 1, p, "done")), next: 6 }),
      ),
    });
    await upgrade.start({ mcVersion: "" });
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(upgrade.stepsDone.value).toBe(6);
  });
});

describe("attach after a page load", () => {
  it("picks up a running job and keeps polling it", async () => {
    const current = vi.fn(async () => job({ events: [ev(1, "plan", "done")], next: 1 }));
    const poll = vi.fn(async () => job({ state: "done", result: { ok: true }, events: [], next: 1 }));
    const { upgrade } = setup({ current, poll });
    await upgrade.attach();
    expect(upgrade.running.value).toBe(true);
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    expect(poll).toHaveBeenCalledWith("j1", 1);
    expect(upgrade.finished.value).toBe(true);
  });

  it("shows a recent result and ignores an old one", async () => {
    const recent = setup({
      current: vi.fn(async () => job({ state: "done", result: { ok: true }, events: [ev(1, "start", "done")], next: 1 })),
    });
    await recent.upgrade.attach();
    expect(recent.upgrade.finished.value).toBe(true);

    const old = setup({
      current: vi.fn(async () =>
        job({ state: "done", result: { ok: true }, events: [ev(1, "start", "done", "", NOW - RECENT_RESULT_SECONDS - 10)], next: 1 }),
      ),
    });
    await old.upgrade.attach();
    expect(old.upgrade.job.value).toBeNull();
  });

  it("does nothing when there has been no upgrade", async () => {
    const { upgrade } = setup();
    await upgrade.attach();
    expect(upgrade.job.value).toBeNull();
  });
});

describe("reset and dispose", () => {
  it("a reset stops a poll in flight from writing back", async () => {
    let release: (j: UpgradeJob) => void = () => {};
    const poll = vi.fn(() => new Promise<UpgradeJob>((resolve) => (release = resolve)));
    const { upgrade } = setup({ poll });
    await upgrade.start({ mcVersion: "1.21.5" });
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS);
    upgrade.reset();
    release(job({ state: "done", result: { ok: true }, events: [], next: 1 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(upgrade.job.value).toBeNull();
  });

  it("dispose stops polling", async () => {
    const { api, upgrade } = setup({ poll: vi.fn(async () => job()) });
    await upgrade.start({ mcVersion: "1.21.5" });
    upgrade.dispose();
    await vi.advanceTimersByTimeAsync(UPGRADE_POLL_MS * 5);
    expect(api.poll).not.toHaveBeenCalled();
  });
});
