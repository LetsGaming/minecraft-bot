/**
 * Session store — the open/close state machine and its crash edges.
 *
 * The plan calls the lifecycle edges "the critical part": crashes emit no
 * leave lines, restarts can orphan open sessions, and a join with a
 * session already open means the leave was missed. All covered here on
 * pure store objects; persistence (kv_store["sessions"]) is exercised via
 * the load fallback test against the real in-memory database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn(),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

import { kvSet } from "../../src/core/db/kv.js";
import { closeDbForTesting } from "../../src/core/db/index.js";
import {
  loadSessionStore,
  getServerSessions,
  openSession,
  closeSession,
  closeAllOpenSessions,
  isOnlineNow,
  totalPlaytimeMs,
  MAX_SESSIONS_PER_PLAYER,
  type SessionStore,
} from "../../src/core/utils/stores/sessionStore.js";

const fresh = (): SessionStore => ({ version: 1, servers: {} });

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting(); // fresh in-memory DB per test
});

describe("loadSessionStore", () => {
  it("returns an empty v1 store for missing/invalid data", async () => {
    expect(await loadSessionStore()).toEqual({ version: 1, servers: {} });

    kvSet("sessions", { bogus: true });
    expect(await loadSessionStore()).toEqual({ version: 1, servers: {} });
  });

  it("passes a valid v1 store through", async () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 1000);
    kvSet("sessions", store);
    // Round-trips through JSON in the kv table — equality, not identity.
    expect(await loadSessionStore()).toEqual(store);
  });
});

describe("open/close lifecycle", () => {
  it("join then leave records one closed session and lastSeen", () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 1_000);
    expect(closeSession(store, "smp", "Alice", 5_000)).toBe(true);

    const entry = getServerSessions(store, "smp")["alice"]!;
    expect(entry.sessions).toEqual([{ joinedAt: 1_000, leftAt: 5_000 }]);
    expect(entry.lastSeen).toBe(5_000);
    expect(isOnlineNow(entry)).toBe(false);
  });

  it("lookups are case-insensitive but keep the latest casing", () => {
    const store = fresh();
    openSession(store, "smp", "ALICE", 1_000);
    expect(closeSession(store, "smp", "alice", 2_000)).toBe(true);
    openSession(store, "smp", "Alice", 3_000);

    const entry = getServerSessions(store, "smp")["alice"]!;
    expect(entry.name).toBe("Alice");
    expect(entry.sessions).toHaveLength(2);
  });

  it("closeSession returns false when nothing is open", () => {
    const store = fresh();
    expect(closeSession(store, "smp", "Ghost")).toBe(false);
    openSession(store, "smp", "Alice", 1);
    closeSession(store, "smp", "Alice", 2);
    expect(closeSession(store, "smp", "Alice", 3)).toBe(false);
  });

  it("discards a stale open session when a join arrives on top (missed leave)", () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 1_000); // leave never seen
    openSession(store, "smp", "Alice", 9_000); // bot restarted meanwhile

    const entry = getServerSessions(store, "smp")["alice"]!;
    // The unreliable stale session is gone, not closed with an invented end.
    expect(entry.sessions).toEqual([{ joinedAt: 9_000, leftAt: null }]);
    expect(isOnlineNow(entry)).toBe(true);
  });

  it("keeps servers isolated", () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 1_000);
    openSession(store, "creative", "Alice", 2_000);
    expect(closeSession(store, "smp", "Alice", 3_000)).toBe(true);
    expect(isOnlineNow(getServerSessions(store, "creative")["alice"]!)).toBe(
      true,
    );
  });
});

describe("closeAllOpenSessions (stop/crash)", () => {
  it("closes every open session at the given time and reports the count", () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 1_000);
    openSession(store, "smp", "Bob", 2_000);
    openSession(store, "smp", "Cara", 3_000);
    closeSession(store, "smp", "Cara", 4_000); // already left

    expect(closeAllOpenSessions(store, "smp", 10_000)).toBe(2);
    const players = getServerSessions(store, "smp");
    expect(players["alice"]!.sessions[0]).toEqual({
      joinedAt: 1_000,
      leftAt: 10_000,
    });
    expect(players["bob"]!.lastSeen).toBe(10_000);
    // Cara's closed session untouched.
    expect(players["cara"]!.sessions[0]!.leftAt).toBe(4_000);
    // Idempotent.
    expect(closeAllOpenSessions(store, "smp", 11_000)).toBe(0);
  });
});

describe("ring buffer + playtime", () => {
  it("keeps only the newest MAX_SESSIONS_PER_PLAYER sessions", () => {
    const store = fresh();
    for (let i = 0; i < MAX_SESSIONS_PER_PLAYER + 7; i++) {
      openSession(store, "smp", "Alice", i * 100);
      closeSession(store, "smp", "Alice", i * 100 + 50);
    }
    const entry = getServerSessions(store, "smp")["alice"]!;
    expect(entry.sessions).toHaveLength(MAX_SESSIONS_PER_PLAYER);
    expect(entry.sessions[0]!.joinedAt).toBe(700); // oldest 7 trimmed
  });

  it("totalPlaytimeMs sums closed sessions and counts open ones to now", () => {
    const store = fresh();
    openSession(store, "smp", "Alice", 0);
    closeSession(store, "smp", "Alice", 1_000);
    openSession(store, "smp", "Alice", 2_000);
    const entry = getServerSessions(store, "smp")["alice"]!;
    expect(totalPlaytimeMs(entry, 2_500)).toBe(1_000 + 500);
  });
});
