import { describe, it, expect } from "vitest";

import {
  ACTIVE_MAX_AGE_MS,
  CompatLimitError,
  JOB_MEMORY_MAX_AGE_MS,
  JOB_MEMORY_MAX_ENTRIES,
  MAX_ACTIVE_GLOBAL,
  MAX_ACTIVE_PER_SERVER,
  MAX_ACTIVE_PER_TENANT,
  REFRESH_MIN_INTERVAL_MS,
  RUNNING_REUSE_MS,
  createCompatGuard,
  type CompatGuard,
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

/** Reserve and commit in one go; returns the job id. */
function start(
  guard: CompatGuard,
  server: string,
  user: string,
  tenant: string,
  version: string,
  refresh = false,
): string {
  const r = guard.reserve(server, user, tenant, version, refresh);
  if (r.kind !== "new") throw new Error("expected a new reservation");
  const id = `${server}-${user}-${version}`;
  r.commit(id);
  return id;
}

/** Reserve, yield once (as a wrapper call would), then commit. Returns whether it got a new slot. */
async function attempt(
  guard: CompatGuard,
  server: string,
  user: string,
  tenant: string,
  refresh = false,
): Promise<boolean> {
  try {
    const r = guard.reserve(server, user, tenant, "1.21.5", refresh);
    await Promise.resolve();
    if (r.kind === "new") {
      r.commit(`${server}-${user}`);
      return true;
    }
    return false;
  } catch (err) {
    expect(err).toBeInstanceOf(CompatLimitError);
    return false;
  }
}

describe("one active job per server and user", () => {
  it("returns the running job for the same version and refuses a different one with 409", async () => {
    const { guard } = setup();
    const id = start(guard, "smp", "u1", "t1", "1.21.5");
    const again = guard.reserve("smp", "u1", "t1", "1.21.5", false);
    expect(again.kind).toBe("existing");
    if (again.kind === "existing") expect(await again.settled).toEqual({ jobId: id });
    expect(refused(() => guard.reserve("smp", "u1", "t1", "1.20.1", false)).statusCode).toBe(409);
  });

  it("frees the slot when the job is seen finished, and after the age cap", () => {
    const { guard, advance } = setup();
    const id = start(guard, "smp", "u1", "t1", "1.21.5");
    guard.observe("smp", job(id, "done"));
    expect(guard.reserve("smp", "u1", "t1", "1.20.1", false).kind).toBe("new");

    advance(ACTIVE_MAX_AGE_MS + 1);
    expect(guard.reserve("smp", "u1", "t1", "1.19", false).kind).toBe("new");
  });

  it("repeated starts by one user never create more than one entry", () => {
    const { guard } = setup();
    start(guard, "smp", "u1", "t1", "1.21.5");
    for (let i = 0; i < 50; i++) guard.reserve("smp", "u1", "t1", "1.21.5", false);
    expect(guard.sizes().active).toBe(1);
  });
});

describe("fair limits", () => {
  it("a tenant at its limit does not starve another tenant", () => {
    const { guard } = setup();
    for (let i = 0; i < MAX_ACTIVE_PER_TENANT; i++) {
      start(guard, "s" + i, "a" + i, "guildA", "1.21.5");
    }
    const err = refused(() => guard.reserve("s9", "a9", "guildA", "1.21.5", false));
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/guild/);
    expect(guard.reserve("s9", "b1", "guildB", "1.21.5", false).kind).toBe("new");
  });

  it("two users of one tenant share the tenant limit", () => {
    const { guard } = setup();
    start(guard, "s1", "u1", "guildA", "1.21.5");
    start(guard, "s2", "u2", "guildA", "1.21.5");
    expect(refused(() => guard.reserve("s3", "u3", "guildA", "1.21.5", false)).statusCode).toBe(429);
  });

  it("a server at its limit refuses further users but not other servers", () => {
    const { guard } = setup();
    for (let i = 0; i < MAX_ACTIVE_PER_SERVER; i++) start(guard, "smp", "u" + i, "t" + i, "1.21.5");
    const err = refused(() => guard.reserve("smp", "late", "tx", "1.21.5", false));
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/server/);
    expect(guard.reserve("other", "late", "tx", "1.21.5", false).kind).toBe("new");
  });

  it("the global backstop only trips when many tenants are busy", () => {
    const { guard } = setup();
    for (let i = 0; i < MAX_ACTIVE_GLOBAL; i++) start(guard, "s" + i, "u" + i, "t" + i, "1.21.5");
    const err = refused(() => guard.reserve("sx", "ux", "tx", "1.21.5", false));
    expect(err.statusCode).toBe(429);
    expect(err.message).toMatch(/all guilds/);
    expect(MAX_ACTIVE_GLOBAL).toBeGreaterThan(MAX_ACTIVE_PER_TENANT * 2);
  });

  it("rolled back reservations leave nothing behind", () => {
    const { guard } = setup();
    for (let i = 0; i < 1000; i++) {
      const r = guard.reserve("s" + (i % 7), "u" + i, "t" + i, "1.21.5", false);
      if (r.kind === "new") r.rollback(new Error("done"));
    }
    expect(guard.sizes().active).toBe(0);
  });
});

describe("reservation is atomic", () => {
  it("concurrent starts by one user: exactly one new, the rest share its result", async () => {
    const { guard } = setup();
    const results = await Promise.all(
      Array.from({ length: 25 }, async () => {
        const r = guard.reserve("smp", "u1", "t1", "1.21.5", false);
        if (r.kind === "new") {
          await Promise.resolve();
          r.commit("job-1");
          return "new";
        }
        await r.settled;
        return "existing";
      }),
    );
    expect(results.filter((r) => r === "new")).toHaveLength(1);
    expect(guard.sizes().active).toBe(1);
  });

  it("concurrent starts by many users of one guild hold the tenant and server caps exactly", async () => {
    const { guard } = setup();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_v, i) => attempt(guard, "smp", "u" + i, "sameGuild")),
    );
    expect(results.filter(Boolean)).toHaveLength(Math.min(MAX_ACTIVE_PER_SERVER, MAX_ACTIVE_PER_TENANT));
  });

  it("concurrent starts across tenants and servers hold the global cap exactly", async () => {
    const { guard } = setup();
    const results = await Promise.all(
      Array.from({ length: 100 }, (_v, i) => attempt(guard, "s" + i, "u" + i, "t" + i)),
    );
    expect(results.filter(Boolean)).toHaveLength(MAX_ACTIVE_GLOBAL);
  });

  it("concurrent refreshes on one server let exactly one through", async () => {
    const { guard } = setup();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_v, i) => attempt(guard, "smp", "u" + i, "t" + i, true)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("rollback frees the slot and the refresh timestamp so a retry works", () => {
    const { guard } = setup();
    const r = guard.reserve("smp", "u1", "t1", "1.21.5", true);
    if (r.kind !== "new") throw new Error("expected new");
    r.rollback(new Error("wrapper down"));
    expect(guard.sizes().active).toBe(0);
    expect(guard.reserve("smp", "u1", "t1", "1.21.5", true).kind).toBe("new");
  });

  it("a shared waiter sees the failure when the owner rolls back", async () => {
    const { guard } = setup();
    const first = guard.reserve("smp", "u1", "t1", "1.21.5", false);
    const second = guard.reserve("smp", "u1", "t1", "1.21.5", false);
    if (first.kind !== "new" || second.kind !== "existing") throw new Error("shape");
    first.rollback(new Error("wrapper down"));
    await expect(second.settled).rejects.toThrow("wrapper down");
  });
});

describe("refresh spam", () => {
  it("allows one refresh per server per interval", () => {
    const { guard, advance } = setup();
    const id = start(guard, "smp", "u1", "t1", "1.21.5", true);
    guard.observe("smp", job(id, "done"));
    expect(refused(() => guard.reserve("smp", "u2", "t2", "1.21.5", true)).statusCode).toBe(429);
    expect(guard.reserve("other", "u2", "t2", "1.21.5", true).kind).toBe("new");
    advance(REFRESH_MIN_INTERVAL_MS + 1);
    expect(guard.reserve("smp", "u3", "t3", "1.21.5", true).kind).toBe("new");
  });

  it("a refresh while the own job runs is refused", () => {
    const { guard } = setup();
    start(guard, "smp", "u1", "t1", "1.21.5");
    expect(refused(() => guard.reserve("smp", "u1", "t1", "1.21.5", true)).statusCode).toBe(409);
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
