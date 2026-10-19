import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { usePolledJob, DEFAULT_POLL_RETRIES } from "../../src/web/frontend/src/composables/usePolledJob.js";
import type { PageVisibility } from "../../src/web/frontend/src/utils/pageVisibility.js";

const INTERVAL = 1000;
type State = { state: "running" | "done" };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(poll: () => Promise<State>, visibility?: PageVisibility) {
  const onUpdate = vi.fn();
  const onDone = vi.fn();
  const onError = vi.fn();
  const job = usePolledJob<State>({
    intervalMs: INTERVAL,
    poll,
    onUpdate,
    isDone: (s) => s.state === "done",
    onDone,
    onError,
    visibility,
  });
  return { job, onUpdate, onDone, onError };
}

describe("usePolledJob", () => {
  it("polls until the job is done, then stops", async () => {
    const poll = vi
      .fn<() => Promise<State>>()
      .mockResolvedValueOnce({ state: "running" })
      .mockResolvedValueOnce({ state: "done" });
    const { job, onDone, onUpdate } = setup(poll);
    await job.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    expect(poll).toHaveBeenCalledTimes(2);
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(onDone).toHaveBeenCalledTimes(1);
    job.dispose();
  });

  it("waits one interval before the first poll unless immediate", async () => {
    const poll = vi.fn(async (): Promise<State> => ({ state: "done" }));
    const { job } = setup(poll);
    await job.start();
    expect(poll).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    job.dispose();
  });

  it("retries a failed poll and recovers without reporting", async () => {
    const poll = vi
      .fn<() => Promise<State>>()
      .mockRejectedValueOnce(new Error("blip"))
      .mockRejectedValueOnce(new Error("blip"))
      .mockResolvedValueOnce({ state: "done" });
    const { job, onError, onDone } = setup(poll);
    await job.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(onError).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    job.dispose();
  });

  it("stops and reports once after the retries are used up", async () => {
    const poll = vi.fn(async (): Promise<State> => {
      throw new Error("gone");
    });
    const { job, onError } = setup(poll);
    await job.start({ immediate: true });
    await vi.advanceTimersByTimeAsync(INTERVAL * (DEFAULT_POLL_RETRIES + 5));
    expect(poll).toHaveBeenCalledTimes(DEFAULT_POLL_RETRIES + 1);
    expect(onError).toHaveBeenCalledTimes(1);
    job.dispose();
  });

  it("never lets two polls overlap", async () => {
    let release!: (s: State) => void;
    const poll = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          release = resolve;
        }),
    );
    const { job } = setup(poll);
    await job.start();
    await vi.advanceTimersByTimeAsync(INTERVAL * 4);
    expect(poll).toHaveBeenCalledTimes(1);
    release({ state: "done" });
    job.dispose();
  });

  it("pauses while hidden and resumes when the tab returns", async () => {
    let hidden = true;
    let resume: () => void = () => undefined;
    const visibility: PageVisibility = {
      isHidden: () => hidden,
      onVisible: (cb) => {
        resume = cb;
        return () => undefined;
      },
    };
    const poll = vi.fn(async (): Promise<State> => ({ state: "running" }));
    const { job } = setup(poll, visibility);
    await job.start();
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(poll).not.toHaveBeenCalled();
    hidden = false;
    resume();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(poll).toHaveBeenCalledTimes(1);
    job.dispose();
  });

  it("ignores a response that lands after stop", async () => {
    let release!: (s: State) => void;
    const poll = vi.fn(
      () =>
        new Promise<State>((resolve) => {
          release = resolve;
        }),
    );
    const { job, onUpdate } = setup(poll);
    const first = job.start({ immediate: true });
    job.stop();
    release({ state: "done" });
    await first;
    expect(onUpdate).not.toHaveBeenCalled();
    job.dispose();
  });
});
