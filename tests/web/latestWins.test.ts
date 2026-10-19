import { describe, it, expect, vi, beforeEach } from "vitest";

const toastAdd = vi.hoisted(() => vi.fn());
// primevue is only installed under src/web, so the bare specifier does not resolve from tests/.
vi.mock("../../src/web/node_modules/primevue/usetoast/index.mjs", () => ({
  useToast: () => ({ add: toastAdd }),
}));

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { useEditableDocument } from "../../src/web/frontend/src/composables/useEditableDocument.js";
import { useInstalledMods, type InstalledModsApi } from "../../src/web/frontend/src/composables/useInstalledMods.js";
import { useGuildSetup } from "../../src/web/frontend/src/composables/useGuildSetup.js";
import { useGuilds } from "../../src/web/frontend/src/composables/useGuilds.js";
import { useServerStatus } from "../../src/web/frontend/src/composables/useServerStatus.js";
import { usePrune, emptyParams, type PruneApi } from "../../src/web/frontend/src/composables/usePrune.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";
import type { InstalledMods } from "../../src/web/frontend/src/api.js";
import type { PruneChunkInfo, PruneScanJob, PruneSummary } from "../../src/schema/wire/index.js";

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
});

describe("useEditableDocument.load", () => {
  it("adopts only the newest read when answers arrive out of order", async () => {
    const slow = deferred<{ doc: { name: string }; token: string }>();
    const fast = deferred<{ doc: { name: string }; token: string }>();
    const queue = [slow, fast];
    const editor = useEditableDocument<{ name: string }>(
      { load: () => queue.shift()!.promise, save: vi.fn() },
      { guard: false },
    );
    const first = editor.load();
    const second = editor.load();
    fast.resolve({ doc: { name: "new" }, token: "t2" });
    expect(await second).toBe(true);
    slow.resolve({ doc: { name: "old" }, token: "t1" });
    expect(await first).toBe(false);
    expect(editor.draft.value?.name).toBe("new");
    expect(editor.token.value).toBe("t2");
    expect(editor.loading.value).toBe(false);
  });

  it("reset drops a read that is still in flight", async () => {
    const pending = deferred<{ doc: { name: string }; token: string }>();
    const editor = useEditableDocument<{ name: string }>({ load: () => pending.promise, save: vi.fn() }, { guard: false });
    const read = editor.load();
    editor.reset();
    pending.resolve({ doc: { name: "late" }, token: "t" });
    expect(await read).toBe(false);
    expect(editor.ready.value).toBe(false);
  });
});

describe("useInstalledMods.load", () => {
  const list = (slug: string): InstalledMods => ({ gameVersion: "1.21.4", modLoader: "fabric", mtimeMs: 1, mods: [{ slug, filename: `${slug}.jar`, versionId: "v" }] });

  it("a slow answer for the old server does not replace the new list", async () => {
    const old = deferred<InstalledMods>();
    const fresh = deferred<InstalledMods>();
    const queue = [old, fresh];
    const api = { fetchInstalled: () => queue.shift()!.promise } as unknown as InstalledModsApi;
    const mods = useInstalledMods(api);
    const first = mods.load();
    mods.reset();
    const second = mods.load();
    fresh.resolve(list("new-server-mod"));
    await second;
    old.resolve(list("old-server-mod"));
    await first;
    expect(mods.mods.value.map((m) => m.slug)).toEqual(["new-server-mod"]);
    expect(mods.loading.value).toBe(false);
  });
});

describe("useGuilds.load", () => {
  it("a second call waits for the request already in flight", async () => {
    const pending = deferred<{ guilds: Array<{ id: string; name: string; icon: string | null }> }>();
    net.apiGet.mockImplementation(() => pending.promise);
    const g = useGuilds();
    const first = g.load(true);
    let secondDone = false;
    const second = g.load(true).then(() => {
      secondDone = true;
    });
    await Promise.resolve();
    expect(secondDone).toBe(false);
    expect(net.apiGet).toHaveBeenCalledTimes(1);
    pending.resolve({ guilds: [{ id: "1", name: "One", icon: null }] });
    await Promise.all([first, second]);
    expect(secondDone).toBe(true);
    expect(g.guildName("1")).toBe("One");
  });
});

describe("useServerStatus", () => {
  it("does not claim the bot is alive before the first answer", async () => {
    const pending = deferred<{ bot: { alive: boolean; lastBeat: null }; servers: [] }>();
    net.apiGet.mockImplementation(() => pending.promise);
    const status = useServerStatus();
    expect(status.botAlive.value).toBeNull();
    const refresh = status.refresh();
    pending.resolve({ bot: { alive: false, lastBeat: null }, servers: [] });
    await refresh;
    expect(status.botAlive.value).toBe(false);
  });
});

describe("useGuildSetup.loadChannelsRoles", () => {
  it("never caches one guild's channels as another's when answers interleave", async () => {
    const slowA = deferred<{ channels: Array<{ id: string; name: string; type: number }> }>();
    net.apiGet.mockImplementation((path: string) => {
      if (path === "/api/setup/guilds/a/channels") return slowA.promise;
      if (path === "/api/setup/guilds/a/roles") return Promise.resolve({ roles: [] });
      if (path === "/api/setup/guilds/b/channels") return Promise.resolve({ channels: [{ id: "b-chan", name: "b", type: 0 }] });
      if (path === "/api/setup/guilds/b/roles") return Promise.resolve({ roles: [] });
      throw new Error(`unexpected ${path}`);
    });
    const s = useGuildSetup(() => false, () => "");
    s.guildId.value = "a";
    const loadA = s.loadChannelsRoles();
    s.guildId.value = "b";
    await s.loadChannelsRoles();
    slowA.resolve({ channels: [{ id: "a-chan", name: "a", type: 0 }] });
    await loadA;
    expect(s.channelsForGuild.value).toBe("b");
    expect(s.channels.value.map((c) => c.id)).toEqual(["b-chan"]);
    expect(s.loadingChannels.value).toBe(false);
  });
});

describe("usePrune.inspect", () => {
  const info = (tag: string) => ({ tag }) as unknown as PruneChunkInfo;

  it("a late answer for another dimension at the same coordinates is ignored", async () => {
    const overworld = deferred<PruneChunkInfo>();
    const nether = deferred<PruneChunkInfo>();
    const answers: Record<string, ReturnType<typeof deferred<PruneChunkInfo>>> = { overworld, the_nether: nether };
    const api: PruneApi = {
      support: vi.fn(async () => ({ supported: true })),
      settings: vi.fn(async () => emptyParams()),
      save: vi.fn(),
      scan: vi.fn(async () => ({ jobId: "j" })),
      poll: vi.fn(async () => ({ jobId: "j", state: "done", result: { id: "plan", dimensions: [], totals: {} } as unknown as PruneSummary }) as PruneScanJob),
      map: vi.fn(),
      apply: vi.fn(),
      chunk: vi.fn((_plan, dimension) => answers[dimension]!.promise),
    } as unknown as PruneApi;
    const prune = usePrune({ api, onError: vi.fn() });
    await prune.scan();
    const first = prune.inspect("overworld", 5, 5);
    const second = prune.inspect("the_nether", 5, 5);
    nether.resolve(info("nether"));
    await second;
    overworld.resolve(info("overworld"));
    await first;
    expect(prune.inspected.value).toMatchObject({ dimension: "the_nether", loading: false });
    expect((prune.inspected.value?.info as unknown as { tag: string }).tag).toBe("nether");
  });
});
