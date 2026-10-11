import { describe, it, expect, vi } from "vitest";

import {
  useInstalledMods,
  type InstalledModsApi,
} from "../../src/web/frontend/src/composables/useInstalledMods.js";
import { ApiError, UnauthorizedError } from "../../src/web/frontend/src/api.js";
import type { InstalledMods } from "../../src/web/frontend/src/api.js";

const LIST: InstalledMods = {
  gameVersion: "1.21.4",
  modLoader: "fabric",
  mtimeMs: 1,
  mods: [
    { slug: "sodium", filename: "sodium.jar", versionId: "v1", enabled: true },
    { slug: "lithium", filename: "lithium.jar", versionId: "v2" },
  ],
};

function setup(overrides: Partial<InstalledModsApi> = {}) {
  const api: InstalledModsApi = {
    fetchInstalled: vi.fn(async () => LIST),
    checkUpdates: vi.fn(async () => ({
      mcVersion: "1.21.4",
      modLoader: "fabric",
      results: [
        { slug: "sodium", status: "update_available", latestVersionId: "v9" },
        { slug: "lithium", status: "up_to_date" },
      ],
    })),
    updateOne: vi.fn(async () => ({ ok: true, updated: [{ slug: "sodium", filename: "s.jar", toVersionId: "v9" }] })),
    remove: vi.fn(async () => ({ ok: true })),
    disable: vi.fn(async () => ({ ok: true })),
    enable: vi.fn(async () => ({ ok: true })),
    applyUpdates: vi.fn(async () => ({ ok: true, updated: [{ slug: "sodium", filename: "s.jar", toVersionId: "v9" }] })),
    ...overrides,
  };
  return { api, mods: useInstalledMods(api) };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("installed list", () => {
  it("loads the list and clears an earlier failure", async () => {
    const fetchInstalled = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(502, "wrapper down"))
      .mockResolvedValueOnce(LIST);
    const { mods } = setup({ fetchInstalled });
    await mods.load();
    expect(mods.installed.value).toBeNull();
    expect(mods.loadError.value).toEqual({ message: "wrapper down", status: 502 });
    await mods.load();
    expect(mods.mods.value.map((m) => m.slug)).toEqual(["sodium", "lithium"]);
    expect(mods.loadError.value).toBeNull();
    expect(mods.loading.value).toBe(false);
  });

  it("keeps the last good list when a reload fails, and says so", async () => {
    const fetchInstalled = vi.fn().mockResolvedValueOnce(LIST).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { mods } = setup({ fetchInstalled });
    await mods.load();
    await mods.load();
    expect(mods.mods.value).toHaveLength(2);
    expect(mods.loadError.value).toEqual({ message: "Failed to fetch", status: null });
  });

  it("leaves a 401 to the shell instead of showing it as a load error", async () => {
    const { mods } = setup({ fetchInstalled: vi.fn().mockRejectedValue(new UnauthorizedError()) });
    await mods.load();
    expect(mods.loadError.value).toBeNull();
  });
});

describe("update check", () => {
  it("collects the slugs with an update", async () => {
    const { mods, api } = setup();
    await mods.load();
    await mods.refreshUpdates(false);
    expect(api.checkUpdates).toHaveBeenCalledWith(false);
    expect(mods.updateCount.value).toBe(1);
    expect(mods.hasUpdate("sodium")).toBe(true);
    expect(mods.hasUpdate("lithium")).toBe(false);
  });

  it("reports a failed check and keeps the previous answer", async () => {
    const checkUpdates = vi
      .fn()
      .mockResolvedValueOnce({ mcVersion: "", modLoader: "", results: [{ slug: "sodium", status: "update_available" }] })
      .mockRejectedValueOnce(new ApiError(502, "Modrinth is unavailable"));
    const { mods } = setup({ checkUpdates });
    await mods.refreshUpdates();
    await mods.refreshUpdates();
    expect(mods.updatesError.value).toBe("Modrinth is unavailable");
    expect(mods.hasUpdate("sodium")).toBe(true);
    expect(mods.checkingUpdates.value).toBe(false);
  });
});

describe("row actions", () => {
  it("marks only the acting row busy, with its label, and others stay usable", async () => {
    const gate = deferred<{ ok: boolean }>();
    const { mods } = setup({ remove: vi.fn(() => gate.promise) });
    const running = mods.runRow("sodium", "remove", "Removing");
    expect(mods.isBusy("sodium")).toBe(true);
    expect(mods.busyLabel("sodium")).toBe("Removing");
    expect(mods.isLocked("lithium")).toBe(false);
    gate.resolve({ ok: true });
    await running;
    expect(mods.isBusy("sodium")).toBe(false);
  });

  it("ignores a second action on a busy row", async () => {
    const gate = deferred<{ ok: boolean }>();
    const { mods, api } = setup({ remove: vi.fn(() => gate.promise) });
    const first = mods.runRow("sodium", "remove");
    const second = await mods.runRow("sodium", "update");
    expect(second.ok).toBe(false);
    expect(api.updateOne).not.toHaveBeenCalled();
    gate.resolve({ ok: true });
    await first;
  });

  it("a remove reloads the list and the update check, and marks the slug changed", async () => {
    const { mods, api } = setup();
    const outcome = await mods.runRow("lithium", "remove");
    expect(outcome).toEqual({ ok: true, error: "", changed: 1 });
    expect(api.remove).toHaveBeenCalledWith("lithium");
    expect(api.fetchInstalled).toHaveBeenCalledTimes(1);
    expect(api.checkUpdates).toHaveBeenCalledWith(true);
    expect(mods.changedSinceLoad.has("lithium")).toBe(true);
  });

  it("an update that changed nothing is not a pending change", async () => {
    const { mods } = setup({ updateOne: vi.fn(async () => ({ ok: true, updated: [], upToDate: ["sodium"] })) });
    const outcome = await mods.runRow("sodium", "update");
    expect(outcome.changed).toBe(0);
    expect(mods.changedSinceLoad.has("sodium")).toBe(false);
  });

  it("a toggle reloads the list but not the update check", async () => {
    const { mods, api } = setup();
    await mods.runRow("sodium", "disable");
    expect(api.disable).toHaveBeenCalledWith("sodium");
    expect(api.fetchInstalled).toHaveBeenCalledTimes(1);
    expect(api.checkUpdates).not.toHaveBeenCalled();
  });

  it("returns the wrapper's refusal and reloads nothing", async () => {
    const { mods, api } = setup({ remove: vi.fn(async () => ({ ok: false, error: "not installed" })) });
    const outcome = await mods.runRow("ghost", "remove");
    expect(outcome).toEqual({ ok: false, error: "not installed", changed: 0 });
    expect(api.fetchInstalled).not.toHaveBeenCalled();
    expect(mods.isBusy("ghost")).toBe(false);
  });

  it("turns a request failure into an outcome instead of throwing", async () => {
    const { mods } = setup({ updateOne: vi.fn().mockRejectedValue(new ApiError(502, "boom")) });
    await expect(mods.runRow("sodium", "update")).resolves.toEqual({ ok: false, error: "boom", changed: 0 });
  });
});

describe("apply all", () => {
  it("applies every update once and marks what changed", async () => {
    const { mods, api } = setup();
    const outcome = await mods.applyAll();
    expect(outcome).toEqual({ ok: true, error: "", changed: 1 });
    expect(api.applyUpdates).toHaveBeenCalledTimes(1);
    expect(mods.changedSinceLoad.has("sodium")).toBe(true);
    expect(mods.applyingAll.value).toBe(false);
  });

  it("reset forgets the server's list, markers and errors", async () => {
    const { mods } = setup();
    await mods.load();
    await mods.runRow("lithium", "remove");
    mods.reset();
    expect(mods.installed.value).toBeNull();
    expect(mods.changedSinceLoad.size).toBe(0);
    expect(mods.updateCount.value).toBe(0);
  });
});
