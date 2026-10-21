import { describe, it, expect, vi, beforeEach } from "vitest";

const net = vi.hoisted(() => ({ apiGet: vi.fn(), apiSend: vi.fn() }));
vi.mock("../../src/web/frontend/src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/web/frontend/src/api")>();
  return { ...actual, apiGet: net.apiGet, apiSend: net.apiSend };
});

import { dayWhere, useDailyRewards } from "../../src/web/frontend/src/composables/useDailyRewards.js";
import { clearDirtySources } from "../../src/web/frontend/src/composables/useUnsavedGuard.js";
import { sharePercent, totalWeight } from "@mcbot/schema/dailyRewards.js";

const SHARED = {
  default: [
    { id: "st", item: "stone", amount: 64, weight: 10 },
    { id: "ir", item: "iron_ingot", amount: 8, weight: 30 },
    { id: "d1", item: "diamond", amount: 1, weight: 40 },
    { id: "d64", item: "diamond", amount: 64, weight: 20 },
  ],
  streakBonuses: { "7": [{ id: "em", item: "emerald", amount: 3 }] },
  bonusChance: 5,
};

let serverOverride: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  clearDirtySources();
  serverOverride = { bonusChance: 20 };
  net.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/rewards") {
      return { shared: { pool: structuredClone(SHARED), problems: [], hash: "h1", exists: true }, shipped: null };
    }
    if (path === "/api/servers/smp/rewards") {
      return {
        override: { pool: structuredClone(serverOverride), problems: [], hash: "o1", exists: true },
        shared: { pool: structuredClone(SHARED), problems: [] },
      };
    }
    throw new Error(`unexpected ${path}`);
  });
  net.apiSend.mockResolvedValue({ hash: "next" });
});

async function shared() {
  const r = useDailyRewards();
  await r.open("");
  return r;
}
async function server() {
  const r = useDailyRewards();
  await r.open("smp");
  return r;
}

describe("the shared pool", () => {
  it("edits a chance in percent by changing that one weight", async () => {
    const r = await shared();
    r.setPercent("st", 50);
    const pool = r.items.value;
    expect(sharePercent(pool[0]!.weight!, totalWeight(pool))).toBeCloseTo(50, 3);
    expect(pool[1]!.weight).toBe(30);
    expect(r.dirtyKeys.value).toEqual(["default"]);
  });

  it("adds a new item with an id at the pool's average weight", async () => {
    const r = await shared();
    const id = r.addEntry("default", "golden_apple", 2);
    expect(id).toBeTruthy();
    expect(r.items.value.at(-1)).toEqual({ id, item: "golden_apple", amount: 2, weight: 25 });
  });

  it("adds an item with the weight it was given, or the average", async () => {
    const r = await shared();
    expect(r.defaultWeight()).toBe(25);
    r.addEntry("default", "apple", 3, 7);
    r.addEntry("default", "bread", 1);
    expect(r.items.value.slice(-2)).toMatchObject([{ item: "apple", amount: 3, weight: 7 }, { item: "bread", weight: expect.closeTo(21.4, 1) }]);
  });

  it("removes one of two entries for the same item and leaves the other", async () => {
    const r = await shared();
    r.removeEntry("default", "d1");
    expect(r.items.value.map((e) => e.id)).toEqual(["st", "ir", "d64"]);
  });

  it("stays clean when a field re-emits the value it displays", async () => {
    const r = await shared();
    const row = r.items.value[0]!;
    const shown = Math.round(sharePercent(row.weight!, r.total.value) * 1000) / 1000;
    r.setPercent("st", shown);
    r.setWeight("st", row.weight!);
    expect(r.dirty.value).toBe(false);
  });

  it("rescales weights to 100 without moving any chance", async () => {
    const r = await shared();
    r.setWeight("st", 20); // 20 / 110
    r.normalizeWeights();
    expect(totalWeight(r.items.value)).toBeCloseTo(100, 3);
    expect(sharePercent(r.items.value[0]!.weight!, 100)).toBeCloseTo((20 / 110) * 100, 3);
  });

  it("undoes a removal", async () => {
    const r = await shared();
    r.removeEntry("default", "ir");
    expect(r.lastUndo.value).toBe("remove");
    r.undo();
    expect(r.items.value).toHaveLength(4);
    expect(r.dirty.value).toBe(false);
  });

  it("adds, copies and removes streak days", async () => {
    const r = await shared();
    expect(r.addDay(14)).toBe(true);
    expect(r.addDay(14)).toBe(false);
    expect(r.poolProblems.value.join()).toContain("streakBonuses.14");
    r.addEntry(dayWhere(14), "bread", 4);
    expect(r.poolProblems.value).toEqual([]);
    expect(r.duplicateDay("14", 20)).toBe(true);
    expect(r.dayRows.value.map((d) => d.day)).toEqual(["7", "14", "20"]);
    r.removeDay("14");
    expect(r.dayRows.value.map((d) => d.day)).toEqual(["7", "20"]);
  });

  it("saves the draft, and the keep and exclude choices, with the hash it loaded", async () => {
    const r = await shared();
    r.removeEntry("default", "ir");
    r.setSelections({ smp: { keep: { pool: ["ir"] } } });
    expect(await r.save()).toBe(true);
    const [method, path, body] = net.apiSend.mock.calls[0]!;
    expect([method, path]).toEqual(["PUT", "/api/rewards"]);
    expect(body).toMatchObject({ baseHash: "h1", servers: { smp: { keep: { pool: ["ir"] } } } });
    expect(body.pool.default.map((e: { id: string }) => e.id)).toEqual(["st", "d1", "d64"]);
  });

  it("asks what the draft would change per server", async () => {
    const r = await shared();
    net.apiSend.mockResolvedValueOnce({ servers: [{ serverId: "smp", changes: [] }] });
    expect(await r.loadImpact()).toEqual([{ serverId: "smp", changes: [] }]);
    expect(net.apiSend).toHaveBeenCalledWith("POST", "/api/rewards/impact", { pool: expect.objectContaining({ bonusChance: 5 }) });
  });
});

describe("a server's exceptions", () => {
  it("lists the shared entries as inherited, with the server's own bonus chance in effect", async () => {
    const r = await server();
    expect(r.poolRows.value.map((x) => x.state)).toEqual(["inherited", "inherited", "inherited", "inherited"]);
    expect(r.bonusChance.value).toBe(20);
    expect(r.dirty.value).toBe(false);
  });

  it("removing an inherited entry writes a remove, and restoring takes it back", async () => {
    const r = await server();
    r.removeEntry("default", "d64");
    expect(r.poolRows.value.find((x) => x.id === "d64")?.state).toBe("removed");
    expect(r.items.value.map((e) => e.id)).toEqual(["st", "ir", "d1"]);
    expect(r.dirtyKeys.value).toEqual(["default"]);
    r.restoreEntry("default", "d64");
    expect(r.dirty.value).toBe(false);
  });

  it("editing an inherited value writes a set, and editing it back clears it", async () => {
    const r = await server();
    r.setWeight("st", 99);
    expect(r.poolRows.value[0]).toMatchObject({ state: "changed", entry: { weight: 99 }, shared: { weight: 10 } });
    r.setAmount("default", "st", 32);
    expect((r.draft.value as { default: { set: Record<string, unknown> } }).default.set.st).toEqual({
      item: "stone",
      weight: 99,
      amount: 32,
    });
    r.setWeight("st", 10);
    r.setAmount("default", "st", 64);
    expect(r.poolRows.value[0]!.state).toBe("inherited");
    expect(r.dirty.value).toBe(false);
  });

  it("adds the server's own entries and keeps the shared pool out of the saved file", async () => {
    const r = await server();
    const id = r.addEntry("default", "apple", 3)!;
    expect(r.poolRows.value.at(-1)).toMatchObject({ id, state: "added" });
    expect(await r.save()).toBe(true);
    const body = net.apiSend.mock.calls[0]![2];
    expect(Object.keys(body.pool.default)).toEqual(["add"]);
    expect(body.pool.default.add).toHaveLength(1);
    expect(body.pool).toMatchObject({ bonusChance: 20 });
  });

  it("keeps an entry as it is when detached, and follows the shared one again when re-attached", async () => {
    const r = await server();
    r.setWeight("st", 99);
    r.detach("default", ["st"]);
    const row = r.poolRows.value.find((x) => x.state === "detached")!;
    expect(row.entry).toMatchObject({ item: "stone", weight: 99, detachedFrom: "st" });
    expect(r.poolRows.value.find((x) => x.id === "st")?.state).toBe("removed");
    r.reattach("default", row.id);
    expect(r.poolRows.value.map((x) => x.state)).toEqual(["inherited", "inherited", "inherited", "inherited"]);
  });

  it("removes and restores a shared streak day, and starts a new one", async () => {
    const r = await server();
    r.removeDay("7");
    expect(r.dayRows.value[0]).toMatchObject({ day: "7", state: "removed" });
    r.restoreDay("7");
    expect(r.dayRows.value[0]!.state).toBe("inherited");

    expect(r.addDay(14)).toBe(true);
    expect(r.dayRows.value.at(-1)).toMatchObject({ day: "14", state: "added", rows: [] });
    expect(r.poolProblems.value.join()).toContain("streakBonuses.14");
    r.addEntry(dayWhere(14), "bread");
    expect(r.poolProblems.value).toEqual([]);
  });

  it("changing a shared day's items marks the day as changed", async () => {
    const r = await server();
    r.addEntry(dayWhere(7), "bread", 2);
    expect(r.dayRows.value[0]!.state).toBe("changed");
    expect(r.effectivePool.value.streakBonuses!["7"]!.map((e) => e.item)).toEqual(["emerald", "bread"]);
  });

  it("resets one field so the server follows the shared pool again", async () => {
    const r = await server();
    r.removeEntry("default", "st");
    r.resetField("default");
    expect(r.dirty.value).toBe(false);
    expect(r.items.value).toHaveLength(4);
  });

  it("setting the bonus chance back to the shared value drops the exception", async () => {
    const r = await server();
    r.setBonusChance(5);
    expect(r.overrides("bonusChance")).toBe(false);
    expect(r.bonusChance.value).toBe(5);
  });

  it("summarises the effective change for the edit bar", async () => {
    const r = await server();
    r.removeEntry("default", "st");
    r.addEntry("default", "apple");
    r.removeDay("7");
    expect(r.summary.value).toMatchObject({
      items: { added: 1, removed: 1, changed: 0 },
      daysRemoved: 1,
    });
  });
});
