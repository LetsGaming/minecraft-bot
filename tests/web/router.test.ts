import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryHistory, type Router } from "vue-router";
import {
  createAppRouter,
  navLocation,
  patchedLocation,
  NAV_ENTRIES,
  NAV_GROUPS,
  type LeavePrompt,
} from "../../src/web/frontend/src/router.js";
import {
  registerDirtySource,
  clearDirtySources,
} from "../../src/web/frontend/src/composables/useUnsavedGuard.js";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let dirty = false;
let ask: ReturnType<typeof vi.fn<LeavePrompt>>;
let router: Router;

async function start(path: string): Promise<void> {
  router = createAppRouter(createMemoryHistory(), ask);
  await router.push(path);
  await router.isReady();
}

beforeEach(() => {
  clearDirtySources();
  dirty = false;
  registerDirtySource(() => dirty);
  ask = vi.fn<LeavePrompt>(async () => false);
});

describe("nav model", () => {
  it("lists fifteen views in three groups, each with its own icon", () => {
    expect(NAV_GROUPS.map((g) => g.id)).toEqual(["monitor", "manage", "admin"]);
    expect(NAV_ENTRIES).toHaveLength(15);
    expect(new Set(NAV_ENTRIES.map((e) => e.icon)).size).toBe(15);
  });

  it("puts the server into server scoped locations only", async () => {
    await start("/overview");
    const mods = NAV_ENTRIES.find((e) => e.id === "mods")!;
    const audit = NAV_ENTRIES.find((e) => e.id === "audit")!;
    expect(router.resolve(navLocation(mods, "smp")).fullPath).toBe("/mods/smp");
    expect(router.resolve(navLocation(mods, "")).fullPath).toBe("/mods");
    expect(router.resolve(navLocation(audit, "smp")).fullPath).toBe("/audit");
  });
});

describe("deep links", () => {
  it("resolves view, server, file and filters from the URL", async () => {
    await start("/modconfig/smp/abc123");
    expect(router.currentRoute.value.meta.nav).toBe("modconfig");
    expect(router.currentRoute.value.params).toMatchObject({ server: "smp", fileId: "abc123" });

    await router.push("/mods/smp?check=1.21.4&filter=blockers");
    expect(router.currentRoute.value.query).toEqual({ check: "1.21.4", filter: "blockers" });

    await router.push("/config/raw");
    expect(router.currentRoute.value.params.mode).toBe("raw");
  });

  it("sends unknown paths home", async () => {
    await start("/nope/at/all");
    expect(router.currentRoute.value.name).toBe("home");
  });

  it("patches query values and drops the ones cleared", async () => {
    await start("/mods/smp?check=1.21.4&filter=blockers");
    await router.replace(
      patchedLocation(router.currentRoute.value, { query: { filter: undefined } }),
    );
    expect(router.currentRoute.value.fullPath).toBe("/mods/smp?check=1.21.4");
  });
});

describe("leave guard", () => {
  it("lets a clean page leave without asking", async () => {
    await start("/config");
    await router.push("/audit");
    expect(ask).not.toHaveBeenCalled();
    expect(router.currentRoute.value.path).toBe("/audit");
  });

  it("blocks leaving a dirty page when the user stays", async () => {
    await start("/config");
    dirty = true;
    await router.push("/audit");
    expect(ask).toHaveBeenCalledWith("leave");
    expect(router.currentRoute.value.path).toBe("/config");
  });

  it("leaves a dirty page when the user discards", async () => {
    await start("/config");
    dirty = true;
    ask.mockResolvedValueOnce(true);
    await router.push("/audit");
    expect(router.currentRoute.value.path).toBe("/audit");
  });

  it("keeps the page when the back button would discard edits", async () => {
    await start("/audit");
    await router.push("/config");
    dirty = true;
    router.back();
    await settle();
    await settle();
    expect(ask).toHaveBeenCalledWith("leave");
    expect(router.currentRoute.value.path).toBe("/config");
  });

  it("asks before a server switch on a dirty page", async () => {
    await start("/modconfig/smp/abc");
    dirty = true;
    await router.push("/modconfig/creative");
    expect(ask).toHaveBeenCalledWith("server");
    expect(router.currentRoute.value.params.server).toBe("smp");
  });

  it("does not ask when only in-view state changes", async () => {
    await start("/modconfig/smp/abc");
    dirty = true;
    await router.replace("/modconfig/smp/def");
    expect(router.currentRoute.value.params.fileId).toBe("def");

    await start("/mods/smp?check=1.21.4");
    await router.replace("/mods/smp?check=1.21.5&filter=blockers");
    expect(router.currentRoute.value.query.filter).toBe("blockers");
    expect(ask).not.toHaveBeenCalled();
  });

  it("does not ask when the shell fills in the server", async () => {
    await start("/console");
    dirty = true;
    await router.replace("/console/smp");
    expect(ask).not.toHaveBeenCalled();
    expect(router.currentRoute.value.params.server).toBe("smp");
  });
});
