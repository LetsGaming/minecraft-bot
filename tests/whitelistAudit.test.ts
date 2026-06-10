import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks ────────────────────────────────────────────────────────
vi.mock("../src/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/utils/time.js", () => ({
  formatDatetime: vi.fn().mockReturnValue("2025-01-01 12:00:00"),
  TZ: "UTC",
  formatDate: vi.fn(),
  formatTime: vi.fn(),
  nextMidnightEpoch: vi.fn(),
  msUntilMidnight: vi.fn(),
}));

import { loadJson, saveJson } from "../src/utils/utils.js";
import {
  loadAudit,
  recordAdd,
  recordRemove,
  getAuditEntry,
} from "../src/utils/whitelistAudit.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadJson).mockResolvedValue({});
  vi.mocked(saveJson).mockResolvedValue(undefined);
});

// ── loadAudit ──────────────────────────────────────────────────────────────

describe("loadAudit", () => {
  it("returns an empty object when no data exists", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    const audit = await loadAudit();
    expect(audit).toEqual({});
  });

  it("returns existing audit data", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      steve: { username: "Steve", addedBy: "admin", addedById: "u1", addedAt: "2025-01-01", server: "survival" },
    });
    const audit = await loadAudit();
    expect(audit).toHaveProperty("steve");
  });
});

// ── recordAdd ─────────────────────────────────────────────────────────────

describe("recordAdd", () => {
  it("creates a new audit entry with correct fields", async () => {
    await recordAdd("Steve", "Admin#0001", "admin-id", "survival");

    expect(saveJson).toHaveBeenCalledOnce();
    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    expect(savedArg).toHaveProperty("steve");
    const entry = savedArg["steve"] as Record<string, unknown>;
    expect(entry.username).toBe("Steve");
    expect(entry.addedBy).toBe("Admin#0001");
    expect(entry.addedById).toBe("admin-id");
    expect(entry.server).toBe("survival");
    expect(entry.addedAt).toBe("2025-01-01 12:00:00");
  });

  it("keys by lowercase username", async () => {
    await recordAdd("ALEX", "Admin", "aid", "main");
    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(savedArg)).toContain("alex");
  });

  it("stores a provided UUID", async () => {
    await recordAdd("Steve", "Admin", "aid", "main", "uuid-1234");
    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    const entry = savedArg["steve"] as Record<string, unknown>;
    expect(entry.uuid).toBe("uuid-1234");
  });

  it("stores null when UUID is not provided", async () => {
    await recordAdd("Steve", "Admin", "aid", "main");
    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    const entry = savedArg["steve"] as Record<string, unknown>;
    expect(entry.uuid).toBeNull();
  });

  it("overwrites an existing entry for the same player", async () => {
    vi.mocked(loadJson).mockResolvedValueOnce({
      steve: { username: "Steve", addedBy: "OldAdmin", addedById: "old-id", addedAt: "old-time", server: "old" },
    });

    await recordAdd("Steve", "NewAdmin", "new-id", "new-server");

    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    const entry = savedArg["steve"] as Record<string, unknown>;
    expect(entry.addedBy).toBe("NewAdmin");
    expect(entry.server).toBe("new-server");
  });
});

// ── recordRemove ──────────────────────────────────────────────────────────

describe("recordRemove", () => {
  it("adds remove fields to an existing entry", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      bob: { username: "Bob", addedBy: "Admin", addedById: "aid", addedAt: "2025-01-01", server: "main" },
    });

    await recordRemove("Bob", "Mod#1234", "mod-id", "main");

    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    const entry = savedArg["bob"] as Record<string, unknown>;
    expect(entry.removedBy).toBe("Mod#1234");
    expect(entry.removedById).toBe("mod-id");
    expect(entry.removedAt).toBe("2025-01-01 12:00:00");
    expect(entry.removedFromServer).toBe("main");
    // Original fields are preserved
    expect(entry.username).toBe("Bob");
    expect(entry.addedBy).toBe("Admin");
  });

  it("creates a remove-only entry when player was not in audit", async () => {
    vi.mocked(loadJson).mockResolvedValue({});

    await recordRemove("Ghost", "Mod", "mod-id", "survival");

    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    expect(savedArg).toHaveProperty("ghost");
    const entry = savedArg["ghost"] as Record<string, unknown>;
    expect(entry.removedBy).toBe("Mod");
    expect(entry.removedById).toBe("mod-id");
    expect(entry.username).toBe("Ghost");
  });

  it("keys by lowercase username", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    await recordRemove("CHARLIE", "Mod", "mid", "main");
    const savedArg = vi.mocked(saveJson).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(savedArg)).toContain("charlie");
  });
});

// ── getAuditEntry ─────────────────────────────────────────────────────────

describe("getAuditEntry", () => {
  it("returns null when player is not in audit", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    const entry = await getAuditEntry("nobody");
    expect(entry).toBeNull();
  });

  it("returns the audit entry for an existing player", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      alice: { username: "Alice", addedBy: "Admin", addedById: "a1", addedAt: "2025-01-01", server: "main" },
    });
    const entry = await getAuditEntry("alice");
    expect(entry).not.toBeNull();
    expect(entry!.username).toBe("Alice");
  });

  it("looks up by lowercase username (case-insensitive)", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      dave: { username: "Dave", addedBy: "Admin", addedById: "a1", addedAt: "2025-01-01", server: "main" },
    });
    const entry = await getAuditEntry("DAVE");
    expect(entry).not.toBeNull();
    expect(entry!.username).toBe("Dave");
  });
});
