/**
 * Session store: the open/close state machine, its crash edges, and the
 * range queries behind the dashboard. Sessions live in the player_sessions
 * table (in-memory database per test).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import {
  openSession,
  closeSession,
  closeAllOpenSessions,
  getPlayerSummary,
  getServerSummaries,
  listPlayerSummaries,
  listSessions,
  presenceAcrossServers,
  pruneSessions,
  SESSION_RETENTION_DAYS,
} from "../../src/core/utils/stores/sessionStore.js";

const DAY = 86_400_000;

beforeEach(() => {
  closeDbForTesting();
});

describe("open/close lifecycle", () => {
  it("join then leave records one closed session and lastSeen", () => {
    openSession("smp", "Alice", 1000);
    expect(closeSession("smp", "Alice", 5000)).toBe(true);

    expect(listSessions("smp", "alice")).toEqual([{ joinedAt: 1000, leftAt: 5000 }]);
    expect(getPlayerSummary("smp", "ALICE", { now: 9000 })).toMatchObject({
      name: "Alice",
      online: false,
      lastSeen: 5000,
      firstSeen: 1000,
      sessions: 1,
      playtimeMs: 4000,
    });
  });

  it("an open session counts to now and marks the player online", () => {
    openSession("smp", "Alice", 1000);
    const s = getPlayerSummary("smp", "Alice", { now: 4000 });
    expect(s).toMatchObject({ online: true, lastSeen: null, playtimeMs: 3000 });
  });

  it("closing with nothing open returns false", () => {
    expect(closeSession("smp", "Ghost", 10)).toBe(false);
  });

  it("a join while a session is open discards the stale one", () => {
    openSession("smp", "Alice", 1000);
    openSession("smp", "Alice", 2000);
    expect(listSessions("smp", "alice")).toEqual([{ joinedAt: 2000, leftAt: null }]);
  });

  it("keeps the casing of the latest join", () => {
    openSession("smp", "alice", 1);
    closeSession("smp", "alice", 2);
    openSession("smp", "ALICE", 3);
    expect(getPlayerSummary("smp", "alice")?.name).toBe("ALICE");
  });

  it("closeAllOpenSessions closes only that server's open sessions", () => {
    openSession("smp", "A", 1);
    openSession("smp", "B", 1);
    openSession("other", "C", 1);
    closeSession("smp", "B", 2);
    openSession("smp", "B", 3);

    expect(closeAllOpenSessions("smp", 10)).toBe(2);
    expect(getPlayerSummary("smp", "A")).toMatchObject({ online: false, lastSeen: 10 });
    expect(getPlayerSummary("other", "C")?.online).toBe(true);
  });

  it.each(["__proto__", "constructor", "hasOwnProperty"])("tracks a player named %s", (name) => {
    openSession("smp", name, 10);
    closeSession("smp", name, 20);
    expect(listSessions("smp", name)).toEqual([{ joinedAt: 10, leftAt: 20 }]);
    expect(Object.keys(getServerSummaries("smp"))).toEqual([name.toLowerCase()]);
  });

  it("keeps far more than 20 sessions per player", () => {
    for (let i = 0; i < 60; i++) {
      openSession("smp", "Grinder", i * 100);
      closeSession("smp", "Grinder", i * 100 + 50);
    }
    expect(getPlayerSummary("smp", "Grinder", { now: 1e9 })?.sessions).toBe(60);
  });
});

describe("range summaries", () => {
  it("counts only the part of a session inside the window", () => {
    openSession("smp", "Alice", 0);
    closeSession("smp", "Alice", 10_000);
    const s = getPlayerSummary("smp", "Alice", { sinceMs: 6000, now: 20_000 });
    expect(s).toMatchObject({ sessions: 1, playtimeMs: 4000 });
  });

  it("a session that ended before the window does not count", () => {
    openSession("smp", "Alice", 0);
    closeSession("smp", "Alice", 1000);
    expect(getPlayerSummary("smp", "Alice", { sinceMs: 5000, now: 20_000 })).toMatchObject({
      sessions: 0,
      playtimeMs: 0,
    });
  });
});

describe("listPlayerSummaries", () => {
  const now = 100 * DAY;

  function seed(): void {
    // Active: played yesterday, first seen long ago.
    openSession("smp", "Active", now - 50 * DAY);
    closeSession("smp", "Active", now - 50 * DAY + 1000);
    openSession("smp", "Active", now - DAY);
    closeSession("smp", "Active", now - DAY + 3600_000);
    // Quiet: last seen 40 days ago.
    openSession("smp", "Quiet", now - 41 * DAY);
    closeSession("smp", "Quiet", now - 40 * DAY);
    // Newbie: first session this week.
    openSession("smp", "Newbie", now - 2 * DAY);
    closeSession("smp", "Newbie", now - 2 * DAY + 600_000);
    // Online right now.
    openSession("smp", "Here", now - 1000);
  }

  it("all: players with a session inside the window, longest playtime first", () => {
    seed();
    const { rows, total } = listPlayerSummaries("smp", { sinceMs: now - 7 * DAY, now });
    expect(rows.map((r) => r.name)).toEqual(["Active", "Newbie", "Here"]);
    expect(total).toBe(3);
  });

  it("quiet: not online and last seen before the cutoff, window ignored", () => {
    seed();
    const { rows } = listPlayerSummaries("smp", {
      sinceMs: now - 7 * DAY,
      now,
      status: "quiet",
      quietBeforeMs: now - 30 * DAY,
    });
    expect(rows.map((r) => r.name)).toEqual(["Quiet"]);
  });

  it("new: first session starts inside the window", () => {
    seed();
    const { rows } = listPlayerSummaries("smp", { sinceMs: now - 7 * DAY, now, status: "new" });
    expect(rows.map((r) => r.name).sort()).toEqual(["Here", "Newbie"]);
  });

  it("online: only connected players", () => {
    seed();
    const { rows } = listPlayerSummaries("smp", { sinceMs: 0, now, status: "online" });
    expect(rows.map((r) => r.name)).toEqual(["Here"]);
  });

  it("searches by substring and treats % and _ literally", () => {
    seed();
    openSession("smp", "a_b", now - 10);
    expect(listPlayerSummaries("smp", { sinceMs: 0, now, q: "ctiv" }).rows.map((r) => r.name)).toEqual(["Active"]);
    expect(listPlayerSummaries("smp", { sinceMs: 0, now, q: "_" }).rows.map((r) => r.name)).toEqual(["a_b"]);
    expect(listPlayerSummaries("smp", { sinceMs: 0, now, q: "%" }).total).toBe(0);
  });

  it("pages and reports the full total", () => {
    seed();
    const page = listPlayerSummaries("smp", { sinceMs: 0, now, sort: "name", order: "asc", limit: 2, offset: 2 });
    expect(page.rows.map((r) => r.name)).toEqual(["Newbie", "Quiet"]);
    expect(page.total).toBe(4);
  });

  it("is scoped to one server", () => {
    seed();
    openSession("other", "Elsewhere", 1);
    expect(listPlayerSummaries("smp", { sinceMs: 0, now }).rows.map((r) => r.name)).not.toContain("Elsewhere");
  });
});

describe("presenceAcrossServers", () => {
  it("reports each server where the name was seen", () => {
    openSession("a", "Alice", 1);
    closeSession("a", "Alice", 5);
    openSession("b", "alice", 10);
    const p = presenceAcrossServers("ALICE").sort((x, y) => x.serverId.localeCompare(y.serverId));
    expect(p).toEqual([
      { serverId: "a", online: false, lastSeen: 5 },
      { serverId: "b", online: true, lastSeen: null },
    ]);
  });
});

describe("pruneSessions", () => {
  it("drops closed sessions past retention but never an open one", () => {
    const now = 1000 * DAY;
    const old = now - (SESSION_RETENTION_DAYS + 5) * DAY;
    openSession("smp", "Old", old);
    closeSession("smp", "Old", old + 1000);
    openSession("smp", "Stuck", old); // never closed
    openSession("smp", "Recent", now - DAY);
    closeSession("smp", "Recent", now - DAY + 1000);

    expect(pruneSessions(now)).toBe(1);
    const n = getDb().prepare("SELECT COUNT(*) AS n FROM player_sessions").get() as { n: number };
    expect(Number(n.n)).toBe(2);
  });
});
