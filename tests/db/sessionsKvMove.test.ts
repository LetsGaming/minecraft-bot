/**
 * kv_store["sessions"] (the old whole-document store) moves into
 * player_sessions once, keeping the old row under a new key for rollback.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { moveKvSessionsToTable } from "../../src/core/db/importLegacy.js";
import { MIGRATIONS } from "../../src/core/db/migrations.js";
import { listSessions, getPlayerSummary } from "../../src/core/utils/stores/sessionStore.js";

beforeEach(() => {
  closeDbForTesting();
});

function legacyDoc(): unknown {
  return JSON.parse(
    JSON.stringify({
      version: 1,
      servers: {
        smp: {
          alice: {
            name: "Alice",
            lastSeen: 500,
            sessions: [
              { joinedAt: 100, leftAt: 200 },
              { joinedAt: 400, leftAt: 500 },
            ],
          },
          steve: { name: "Steve", lastSeen: null, sessions: [{ joinedAt: 900, leftAt: null }] },
          broken: { name: "Broken", sessions: [{ joinedAt: "no" }, null] },
        },
      },
    }),
  );
}

describe("moveKvSessionsToTable", () => {
  it("imports every valid session, including an open one, and retires the kv row", () => {
    const db = getDb();
    kvSet("sessions", legacyDoc());

    moveKvSessionsToTable(db);

    expect(listSessions("smp", "alice")).toEqual([
      { joinedAt: 400, leftAt: 500 },
      { joinedAt: 100, leftAt: 200 },
    ]);
    expect(getPlayerSummary("smp", "steve")?.online).toBe(true);
    expect(getPlayerSummary("smp", "broken")).toBeNull();
    expect(kvGet("sessions")).toBeNull();
    expect(kvGet("sessions.migrated")).not.toBeNull();
  });

  it("does nothing when there is no kv document", () => {
    moveKvSessionsToTable(getDb());
    expect(getPlayerSummary("smp", "alice")).toBeNull();
  });

  it("does not run twice over existing rows", () => {
    const db = getDb();
    kvSet("sessions", legacyDoc());
    moveKvSessionsToTable(db);
    kvSet("sessions", legacyDoc());
    moveKvSessionsToTable(db);

    expect(listSessions("smp", "alice")).toHaveLength(2);
    expect(kvGet("sessions")).not.toBeNull();
  });

  it("migration ids stay sequential", () => {
    expect(MIGRATIONS.map((m) => m.id)).toEqual(MIGRATIONS.map((_, i) => i + 1));
  });
});
