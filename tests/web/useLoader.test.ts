import { describe, it, expect } from "vitest";
import { latest, useLoader } from "../../src/web/frontend/src/composables/useLoader.js";
import { ApiError } from "../../src/web/frontend/src/api.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("latest", () => {
  it("only the newest request stays current", () => {
    const guard = latest();
    const first = guard.begin();
    const second = guard.begin();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });

  it("cancel invalidates every request in flight", () => {
    const guard = latest();
    const current = guard.begin();
    guard.cancel();
    expect(current()).toBe(false);
  });
});

describe("useLoader", () => {
  it("starts unloaded and reports data after a successful load", async () => {
    const loader = useLoader(async (n: number) => n * 2);
    expect(loader.loaded.value).toBe(false);
    expect(await loader.load(21)).toBe(true);
    expect(loader.data.value).toBe(42);
    expect(loader.loaded.value).toBe(true);
    expect(loader.loading.value).toBe(false);
  });

  it("a slow older response never replaces a newer one", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const pending = [slow, fast];
    const loader = useLoader(() => pending.shift()!.promise);

    const first = loader.load();
    const second = loader.load();
    fast.resolve("new");
    expect(await second).toBe(true);
    slow.resolve("old");
    expect(await first).toBe(false);

    expect(loader.data.value).toBe("new");
    expect(loader.loading.value).toBe(false);
  });

  it("stays loading until the newest request finishes", async () => {
    const slow = deferred<string>();
    const fast = deferred<string>();
    const pending = [slow, fast];
    const loader = useLoader(() => pending.shift()!.promise);

    const first = loader.load();
    const second = loader.load();
    slow.resolve("old");
    await first;
    expect(loader.loading.value).toBe(true);
    fast.resolve("new");
    await second;
    expect(loader.loading.value).toBe(false);
  });

  it("records the message, the failure kind and the raw cause", async () => {
    const err = new ApiError(403, "no access");
    const loader = useLoader(async () => {
      throw err;
    });
    expect(await loader.load()).toBe(false);
    expect(loader.error.value).toBe("no access");
    expect(loader.failure.value).toBe("forbidden");
    expect(loader.cause.value).toBe(err);
    expect(loader.loaded.value).toBe(true);
  });

  it("keeps the last data on error only when asked to", async () => {
    let fail = false;
    const keep = useLoader(async () => {
      if (fail) throw new Error("x");
      return "ok";
    }, { keepDataOnError: true });
    const drop = useLoader(async () => {
      if (fail) throw new Error("x");
      return "ok";
    });
    await keep.load();
    await drop.load();
    fail = true;
    await keep.load();
    await drop.load();
    expect(keep.data.value).toBe("ok");
    expect(drop.data.value).toBeNull();
  });

  it("reset drops the state and ignores a request still in flight", async () => {
    const pending = deferred<string>();
    const loader = useLoader(() => pending.promise);
    const inFlight = loader.load();
    loader.reset();
    pending.resolve("late");
    expect(await inFlight).toBe(false);
    expect(loader.data.value).toBeNull();
    expect(loader.loaded.value).toBe(false);
  });
});
