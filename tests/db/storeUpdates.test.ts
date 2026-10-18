/**
 * The whole-document stores change through one transaction each: concurrent
 * writers must not lose updates, and player names such as `__proto__` are
 * ordinary keys. Runs against the real in-memory database
 * (MCBOT_DB_PATH=":memory:" from tests/setup.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  isVersionedDoc,
  versionedStore,
} from "../../src/core/utils/stores/versionedStore.js";
import {
  createRecord,
  ownGet,
  ownSet,
  toRecord,
} from "../../src/core/utils/stores/safeRecord.js";
import {
  loadSessionStore,
  updateSessionStore,
  getServerSessions,
  openSession,
  closeSession,
  closeAllOpenSessions,
} from "../../src/core/utils/stores/sessionStore.js";
import {
  loadChallengeStore,
  updateChallengeStore,
  addChallenge,
  getActiveChallenge,
  type Challenge,
} from "../../src/core/utils/stores/challengeStore.js";
import {
  loadWatchStore,
  updateWatchStore,
  addWatch,
  takeMatchingWatches,
  MAX_WATCHES_PER_USER,
  type Watch,
} from "../../src/core/utils/stores/watchStore.js";
import {
  putTempBan,
  removeTempBan,
  loadTempBanStore,
} from "../../src/core/utils/stores/tempBanStore.js";
import {
  recordSuggestion,
  dismissSuggestion,
  loadSuggestionLedger,
  getSuggestionRecord,
  mcSubject,
} from "../../src/core/utils/stores/suggestionLedger.js";
import {
  recordControlAction,
  lastControlAction,
} from "../../src/core/utils/stores/serverControlRecord.js";

beforeEach(() => {
  closeDbForTesting();
});

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("isVersionedDoc", () => {
  const shape = { version: 1, container: "items" } as const;

  it("accepts a matching object container", () => {
    expect(isVersionedDoc({ version: 1, items: {} }, shape)).toBe(true);
  });

  it("rejects the wrong version, a missing container, arrays and non-objects", () => {
    expect(isVersionedDoc({ version: 2, items: {} }, shape)).toBe(false);
    expect(isVersionedDoc({ version: 1 }, shape)).toBe(false);
    expect(isVersionedDoc({ version: 1, items: [] }, shape)).toBe(false);
    expect(isVersionedDoc({ version: 1, items: null }, shape)).toBe(false);
    expect(isVersionedDoc(null, shape)).toBe(false);
    expect(isVersionedDoc("x", shape)).toBe(false);
  });

  it("checks for an array container when asked", () => {
    const arrayShape = { version: 1, container: "items", kind: "array" } as const;
    expect(isVersionedDoc({ version: 1, items: [] }, arrayShape)).toBe(true);
    expect(isVersionedDoc({ version: 1, items: {} }, arrayShape)).toBe(false);
  });
});

describe("versionedStore", () => {
  const store = versionedStore<{ version: 1; items: Record<string, number> }>(
    "testDoc",
    { version: 1, container: "items" },
    () => ({ version: 1, items: {} }),
  );

  it("falls back to an empty document for unset or malformed rows", () => {
    expect(store.load()).toEqual({ version: 1, items: {} });
    kvSet("testDoc", { nonsense: true });
    expect(store.load()).toEqual({ version: 1, items: {} });
  });

  it("update sees the stored document and persists the change", () => {
    store.update((doc) => {
      doc.items["a"] = 1;
    });
    const out = store.update((doc) => {
      doc.items["b"] = 2;
      return Object.keys(doc.items);
    });
    expect(out).toEqual(["a", "b"]);
    expect(kvGet("testDoc")).toEqual({ version: 1, items: { a: 1, b: 2 } });
  });

  it("writes nothing when the callback throws", () => {
    store.update((doc) => {
      doc.items["a"] = 1;
    });
    expect(() =>
      store.update((doc) => {
        doc.items["b"] = 2;
        throw new Error("nope");
      }),
    ).toThrow("nope");
    expect(kvGet("testDoc")).toEqual({ version: 1, items: { a: 1 } });
  });
});

describe("safeRecord", () => {
  it.each(["__proto__", "constructor", "toString"])("%s is an ordinary key", (key) => {
    const rec = createRecord<number>();
    expect(ownGet(rec, key)).toBeUndefined();
    ownSet(rec, key, 7);
    expect(ownGet(rec, key)).toBe(7);
    expect(Object.keys(rec)).toEqual([key]);
    expect(Object.getPrototypeOf(rec)).toBeNull();
  });

  it("ownGet and ownSet are safe on plain objects too", () => {
    const plain: Record<string, number> = {};
    expect(ownGet(plain, "__proto__")).toBeUndefined();
    expect(ownGet(plain, "constructor")).toBeUndefined();
    ownSet(plain, "__proto__", 3);
    expect(ownGet(plain, "__proto__")).toBe(3);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
  });

  it("toRecord copies own entries, including a parsed __proto__ key", () => {
    const parsed = JSON.parse('{"__proto__": 1, "a": 2}') as Record<string, number>;
    const copy = toRecord(parsed);
    expect(Object.getPrototypeOf(copy)).toBeNull();
    expect(ownGet(copy, "__proto__")).toBe(1);
    expect(ownGet(copy, "a")).toBe(2);
  });
});

describe("sessionStore updates", () => {
  it("keeps every write when several handlers interleave their awaits", async () => {
    const players = Array.from({ length: 25 }, (_, n) => `Player${n}`);
    await Promise.all(
      players.map(async (player) => {
        await tick();
        updateSessionStore((store) => openSession(store, "smp", player, 1000));
        await tick();
        updateSessionStore((store) => closeSession(store, "smp", player, 2000));
      }),
    );
    const store = await loadSessionStore();
    const entries = Object.values(getServerSessions(store, "smp"));
    expect(entries).toHaveLength(players.length);
    for (const entry of entries) {
      expect(entry.sessions).toEqual([{ joinedAt: 1000, leftAt: 2000 }]);
    }
  });

  it("a join racing a server stop is not overwritten", async () => {
    updateSessionStore((store) => openSession(store, "smp", "Early", 1));
    await Promise.all([
      (async () => {
        await tick();
        updateSessionStore((store) => closeAllOpenSessions(store, "smp", 5));
      })(),
      (async () => {
        await tick();
        updateSessionStore((store) => openSession(store, "smp", "Late", 6));
      })(),
    ]);
    const sessions = getServerSessions(await loadSessionStore(), "smp");
    expect(sessions["early"]!.sessions[0]!.leftAt).toBe(5);
    expect(sessions["late"]!.sessions[0]!.leftAt).toBeNull();
  });

  it.each(["__proto__", "constructor", "hasOwnProperty"])(
    "tracks a player named %s",
    async (name) => {
      updateSessionStore((store) => openSession(store, "smp", name, 10));
      updateSessionStore((store) => closeSession(store, "smp", name, 20));

      const store = await loadSessionStore();
      const players = getServerSessions(store, "smp");
      expect(Object.keys(players)).toEqual([name.toLowerCase()]);
      expect(ownGet(players, name.toLowerCase())).toMatchObject({
        name,
        lastSeen: 20,
        sessions: [{ joinedAt: 10, leftAt: 20 }],
      });
      expect(({} as { sessions?: unknown }).sessions).toBeUndefined();
      expect(Object.getPrototypeOf(players)).toBeNull();
    },
  );
});

describe("challengeStore updates", () => {
  const challenge = (advancement: string): Challenge => ({
    advancement,
    startedBy: "mod#1",
    startedById: "m1",
    startedAt: 1,
    status: "active",
  });

  it("keeps challenges added concurrently on different servers", async () => {
    await Promise.all(
      ["a", "b", "c", "d"].map(async (serverId) => {
        await tick();
        updateChallengeStore((store) =>
          addChallenge(store, serverId, challenge(`adv-${serverId}`)),
        );
      }),
    );
    const store = await loadChallengeStore();
    expect(Object.keys(store.servers).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("a win and a cancel race resolve against the stored state", () => {
    updateChallengeStore((store) => addChallenge(store, "smp", challenge("x")));
    const won = updateChallengeStore((store) => {
      const active = getActiveChallenge(store, "smp");
      if (active) active.status = "won";
      return active !== null;
    });
    const cancelled = updateChallengeStore((store) => {
      const active = getActiveChallenge(store, "smp");
      if (active) active.status = "cancelled";
      return active !== null;
    });
    expect(won).toBe(true);
    expect(cancelled).toBe(false);
  });
});

describe("watchStore", () => {
  const watch = (overrides: Partial<Watch> = {}): Watch => ({
    id: "w",
    userId: "u1",
    kind: "server",
    serverId: "smp",
    createdAt: 1,
    ...overrides,
  });

  it("addWatch stores a new watch and refuses an identical target", async () => {
    expect(addWatch(watch({ id: "a" }))).toEqual({ status: "added", watch: watch({ id: "a" }) });
    expect(addWatch(watch({ id: "b" }))).toMatchObject({
      status: "duplicate",
      watch: { id: "a" },
    });
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["a"]);
  });

  it("treats the same player on another server, or another kind, as new", () => {
    expect(addWatch(watch({ id: "a", kind: "player", player: "steve" })).status).toBe("added");
    expect(addWatch(watch({ id: "b", kind: "player", player: "steve", serverId: "other" })).status).toBe("added");
    expect(addWatch(watch({ id: "c", kind: "player", player: "alex" })).status).toBe("added");
    expect(addWatch(watch({ id: "d" })).status).toBe("added");
    expect(addWatch(watch({ id: "e", kind: "player", player: "steve" })).status).toBe("duplicate");
  });

  it("enforces the per-user cap and counts only the caller's watches", async () => {
    for (let n = 0; n < MAX_WATCHES_PER_USER; n++) {
      expect(addWatch(watch({ id: `w${n}`, kind: "player", player: `p${n}` })).status).toBe("added");
    }
    expect(addWatch(watch({ id: "over" })).status).toBe("limit");
    expect(addWatch(watch({ id: "other", userId: "u2" })).status).toBe("added");
    expect((await loadWatchStore()).watches).toHaveLength(MAX_WATCHES_PER_USER + 1);
  });

  it("concurrent additions cannot exceed the cap", async () => {
    const results = await Promise.all(
      Array.from({ length: MAX_WATCHES_PER_USER + 5 }, async (_, n) => {
        await tick();
        return addWatch(watch({ id: `w${n}`, kind: "player", player: `p${n}` })).status;
      }),
    );
    expect(results.filter((s) => s === "added")).toHaveLength(MAX_WATCHES_PER_USER);
    expect(results.filter((s) => s === "limit")).toHaveLength(5);
  });

  it("a removal racing an addition keeps both effects", async () => {
    addWatch(watch({ id: "old", kind: "player", player: "old" }));
    await Promise.all([
      (async () => {
        await tick();
        updateWatchStore((store) => {
          store.watches = store.watches.filter((w) => w.id !== "old");
        });
      })(),
      (async () => {
        await tick();
        addWatch(watch({ id: "new" }));
      })(),
    ]);
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["new"]);
  });

  it("takeMatchingWatches still removes only the matching one-shots", async () => {
    addWatch(watch({ id: "a" }));
    addWatch(watch({ id: "b", userId: "u2", kind: "player", player: "steve" }));
    const taken = await takeMatchingWatches({ kind: "player", serverId: "smp", player: "Steve" });
    expect(taken.map((w) => w.id)).toEqual(["b"]);
    expect((await loadWatchStore()).watches.map((w) => w.id)).toEqual(["a"]);
  });
});

describe("tempBanStore", () => {
  const ban = (player: string, expiresAt: number) => ({
    player,
    serverId: "smp",
    expiresAt,
    bannedAt: 1,
    by: "mod#1",
    reason: "r",
  });

  it("concurrent bans and releases keep each other's effects", async () => {
    await putTempBan(ban("Keep", 1));
    await Promise.all([
      putTempBan(ban("New", 2)),
      removeTempBan("smp", "keep"),
      putTempBan(ban("Other", 3)),
    ]);
    const store = await loadTempBanStore();
    expect(Object.keys(store.bans).sort()).toEqual(["smp:new", "smp:other"]);
  });

  it("reports whether a release existed", async () => {
    await putTempBan(ban("Steve", 1));
    expect(await removeTempBan("smp", "STEVE")).toBe(true);
    expect(await removeTempBan("smp", "steve")).toBe(false);
  });
});

describe("suggestionLedger", () => {
  it.each(["__proto__", "constructor"])("records suggestions for a player named %s", async (name) => {
    await recordSuggestion(mcSubject(name), "link", 5);
    await recordSuggestion(mcSubject(name), "link", 6);
    await dismissSuggestion(mcSubject(name), "daily");
    const ledger = await loadSuggestionLedger();
    expect(getSuggestionRecord(ledger, mcSubject(name), "link")).toMatchObject({ count: 2, lastAt: 6 });
    expect(getSuggestionRecord(ledger, mcSubject(name), "daily")?.dismissed).toBe(true);
    expect(getSuggestionRecord(ledger, mcSubject("someoneelse"), "link")).toBeNull();
  });

  it("concurrent offers each count", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => recordSuggestion(mcSubject("steve"), "link", 5)),
    );
    const ledger = await loadSuggestionLedger();
    expect(getSuggestionRecord(ledger, mcSubject("steve"), "link")?.count).toBe(10);
  });
});

describe("serverControlRecord", () => {
  it("keeps records of different servers written in turn", () => {
    recordControlAction("a", { kind: "stop", by: "x", byId: "1", at: 1 });
    recordControlAction("b", { kind: "restart", by: "y", byId: "2", at: 2 });
    expect(lastControlAction("a")?.kind).toBe("stop");
    expect(lastControlAction("b")?.kind).toBe("restart");
    expect(lastControlAction("c")).toBeNull();
  });

  it("ignores a stored row that is not a record map", () => {
    kvSet("serverControl", "garbage");
    expect(lastControlAction("a")).toBeNull();
    recordControlAction("a", { kind: "stop", by: "x", byId: "1", at: 1 });
    expect(lastControlAction("a")?.at).toBe(1);
  });

  it("does not resolve inherited properties as records", () => {
    expect(lastControlAction("constructor")).toBeNull();
    expect(lastControlAction("__proto__")).toBeNull();
  });
});
