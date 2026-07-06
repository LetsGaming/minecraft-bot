/**
 * whitelistAudit.test.ts — SQLite-backed whitelist audit trail.
 * Runs against a real in-memory database (tests/setup.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/core/utils/time.js", () => ({
  formatDatetime: vi.fn().mockReturnValue("2026-07-03 12:00:00"),
  TZ: "UTC",
  formatDate: vi.fn(),
  formatTime: vi.fn(),
  nextMidnightEpoch: vi.fn(),
  msUntilMidnight: vi.fn(),
}));

vi.mock("../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { closeDbForTesting } from "../src/core/db/index.js";
import {
  loadAudit,
  recordAdd,
  recordRemove,
  getAuditEntry,
} from "../src/core/utils/whitelistAudit.js";

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting();
});

describe("recordAdd", () => {
  it("stores the add under the lowercased username", async () => {
    await recordAdd("Alice", "admin#1", "100", "smp", "uuid-a");
    const audit = await loadAudit();
    expect(audit.alice).toEqual({
      username: "Alice",
      uuid: "uuid-a",
      addedBy: "admin#1",
      addedById: "100",
      addedAt: "2026-07-03 12:00:00",
      server: "smp",
    });
  });

  it("keeps the known uuid when a re-add passes none", async () => {
    await recordAdd("Bob", "admin#1", "100", "smp", "uuid-b");
    await recordAdd("Bob", "admin#2", "200", "creative");
    const entry = await getAuditEntry("bob");
    expect(entry!.uuid).toBe("uuid-b");
    expect(entry!.addedBy).toBe("admin#2");
    expect(entry!.server).toBe("creative");
  });
});

describe("recordRemove", () => {
  it("adds removal fields to an existing entry, keeping the add info", async () => {
    await recordAdd("Carol", "admin#1", "100", "smp", "uuid-c");
    await recordRemove("Carol", "admin#2", "200", "smp");
    const entry = await getAuditEntry("carol");
    expect(entry!.addedBy).toBe("admin#1");
    expect(entry!.removedBy).toBe("admin#2");
    expect(entry!.removedById).toBe("200");
    expect(entry!.removedAt).toBe("2026-07-03 12:00:00");
    expect(entry!.removedFromServer).toBe("smp");
  });

  it("creates a removal-only entry for a player never recorded as added", async () => {
    await recordRemove("Mallory", "admin#1", "100", "smp");
    const entry = await getAuditEntry("mallory");
    expect(entry!.username).toBe("Mallory");
    expect(entry!.removedBy).toBe("admin#1");
    expect(entry!.addedBy).toBeUndefined();
  });
});

describe("getAuditEntry / loadAudit", () => {
  it("returns null for an unknown player", async () => {
    expect(await getAuditEntry("ghost")).toBeNull();
  });

  it("returns the audit entry for an existing player", async () => {
    await recordAdd("Alice", "admin#1", "100", "smp");
    const entry = await getAuditEntry("alice");
    expect(entry).not.toBeNull();
    expect(entry!.username).toBe("Alice");
  });

  it("looks up by lowercase username (case-insensitive)", async () => {
    await recordAdd("Dave", "admin#1", "100", "smp");
    const entry = await getAuditEntry("DAVE");
    expect(entry).not.toBeNull();
    expect(entry!.username).toBe("Dave");
  });

  it("loadAudit returns every entry keyed by lowercased name", async () => {
    await recordAdd("Alice", "a", "1", "smp");
    await recordRemove("Bob", "a", "1", "smp");
    const audit = await loadAudit();
    expect(Object.keys(audit).sort()).toEqual(["alice", "bob"]);
  });
});
