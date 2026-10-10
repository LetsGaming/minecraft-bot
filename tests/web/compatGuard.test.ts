import { describe, it, expect } from "vitest";

import {
  ACTIVE_MAX_AGE_MS,
  CompatLimitError,
  JOB_MEMORY_MAX_AGE_MS,
  JOB_MEMORY_MAX_ENTRIES,
  MAX_ACTIVE_GLOBAL,
  REFRESH_MIN_INTERVAL_MS,
  RUNNING_REUSE_MS,
  createCompatGuard,
} from "../../src/web/backend/routes/compatGuard.js";
import type { ModCompatJob } from "../../src/core/utils/server/serverAccess.js";

function job(id: string, state: ModCompatJob["state"] = "running"): ModCompatJob {
  return {
    jobId: id,
    state,
    mcVersion: "1.21.5",
    modLoader: "fabric",
    progress: { done: 0, total: 1 },
    partial: [],
  };
}

function setup() {
  let t = 1_000_000;
  const guard = createCompatGuard(() => t);
  return { guard, advance: (ms: number) => (t += ms) };
}

function refused(fn: () => unknown): CompatLimitError {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(CompatLimitError);
    return err as CompatLimitError;
  }
  throw new Error("expected a refusal");
}

describe("one active job per server and user", () => {
  it("returns the running job for the same version and refuses a different one with 409", () => {
    const { guard } = setup();
    guard.started("smp", "u1", "1.21.5", "j1", false);
    expect(guard.admit("smp", "u1", "1.21.5", false)).toEqual({ existingJobId: "j1" });
    expect(refused(() => guard.admit("smp", "u1", "1.20.1", false)).statusCode).toBe(409);
    expect(guard.admit("smp", "u2", "1.20.1", false)).toEqual({ existingJobId: null });
    expect(guard.admit("other", "u1", "1.20.1", false)).toEqual({ existingJobId: null });
  });

  it("frees the slot when the job is seen finished, and after the age cap", () => {
    const { guard, advance } = setup();
    guard.started("smp", "u1", "1.21.5", "j1", false);
    guard.observe("smp", job("j1", "done"));
    expect(guard.admit("smp", "u1", "1.20.1", false).existingJobId).toBeNull();

    guard.started("smp", "u1", "1.21.5", "j2", false);
    advance(ACTIVE_MAX_AGE_MS + 1);
    expect(guard.admit("smp", "u1", "1.20.1", false).existingJobId).toBeNull();
  });

  it("repeated starts by one user never create more than one entry", () => {
    const { guard } = setup();
    for (let i = 0; i < 50; i++) {
      guard.admit("smp", "u1", "1.21.5", false);
      guard.started("smp", "u1", "1.21.5", "j" + i, false);
    }
    expect(guard.sizes().active).toBe(1);
  });
});

describe("global limit", () => {
  it("refuses with 429 beyond the concurrent job limit", () => {
    const { guard } = setup();
    for (let i = 0; i < MAX_ACTIVE_GLOBAL; i++) {
      guard.admit("smp", "u" + i, "1.21.5", false);
      guard.started("smp", "u" + i, "1.21.5", "j" + i, false);
    }
    expect(refused(() => guard.admit("smp", "late", "1.21.5", false)).statusCode).toBe(429);
    guard.observe("smp", job("j0", "failed"));
    expect(guard.admit("smp", "late", "1.21.5", false).existingJobId).toBeNull();
  });

  it("many users cannot grow the bookkeeping past its cap", () => {
    const { guard } = setup();
    for (let i = 0; i < 1000; i++) guard.started("smp", "u" + i, "1.21.5", "j" + i, false);
    expect(guard.sizes().active).toBeLessThanOrEqual(200);
  });
});

describe("refresh spam", () => {
  it("allows one refresh per server per interval", () => {
    const { guard, advance } = setup();
    guard.admit("smp", "u1", "1.21.5", true);
    guard.started("smp", "u1", "1.21.5", "j1", true);
    guard.observe("smp", job("j1", "done"));
    expect(refused(() => guard.admit("smp", "u2", "1.21.5", true)).statusCode).toBe(429);
    expect(guard.admit("other", "u2", "1.21.5", true).existingJobId).toBeNull();
    advance(REFRESH_MIN_INTERVAL_MS + 1);
    expect(guard.admit("smp", "u2", "1.21.5", true).existingJobId).toBeNull();
  });

  it("a refresh while the own job runs is refused", () => {
    const { guard } = setup();
    guard.started("smp", "u1", "1.21.5", "j1", false);
    expect(refused(() => guard.admit("smp", "u1", "1.21.5", true)).statusCode).toBe(409);
  });
});

describe("job memory", () => {
  it("serves a finished job without asking the wrapper, within the age cap", () => {
    const { guard, advance } = setup();
    guard.observe("smp", job("j1", "done"));
    advance(JOB_MEMORY_MAX_AGE_MS - 1);
    expect(guard.recall("smp", "j1")?.state).toBe("done");
    advance(2);
    expect(guard.recall("smp", "j1")).toBeNull();
  });

  it("reuses a running job state only briefly", () => {
    const { guard, advance } = setup();
    guard.observe("smp", job("j1"));
    expect(guard.recall("smp", "j1")).not.toBeNull();
    advance(RUNNING_REUSE_MS + 1);
    expect(guard.recall("smp", "j1")).toBeNull();
  });

  it("is scoped to the server and bounded in entries", () => {
    const { guard } = setup();
    guard.observe("smp", job("j1", "done"));
    expect(guard.recall("other", "j1")).toBeNull();
    for (let i = 0; i < JOB_MEMORY_MAX_ENTRIES * 5; i++) guard.observe("smp", job("x" + i, "done"));
    expect(guard.sizes().jobs).toBeLessThanOrEqual(JOB_MEMORY_MAX_ENTRIES);
    expect(guard.recall("smp", "j1")).toBeNull();
  });

  it("forget drops it", () => {
    const { guard } = setup();
    guard.observe("smp", job("j1", "done"));
    guard.forget("smp", "j1");
    expect(guard.recall("smp", "j1")).toBeNull();
  });
});
