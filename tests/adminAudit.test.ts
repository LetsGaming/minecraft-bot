import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Top-level mocks (same pattern as whitelistAudit.test.ts) ───────────────
vi.mock("../src/common/utils/utils.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../src/common/utils/time.js", () => ({
  formatDatetime: vi.fn().mockReturnValue("2026-07-03 12:00:00"),
  TZ: "UTC",
  formatDate: vi.fn(),
  formatTime: vi.fn(),
  nextMidnightEpoch: vi.fn(),
  msUntilMidnight: vi.fn(),
}));

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { loadJson, saveJson } from "../src/common/utils/utils.js";
import { log } from "../src/common/utils/logger.js";
import {
  loadAdminAudit,
  recordAdminAction,
} from "../src/common/utils/adminAudit.js";
import type { AdminAuditEntry } from "../src/common/utils/adminAudit.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadJson).mockResolvedValue({});
  vi.mocked(saveJson).mockResolvedValue(undefined);
});

describe("adminAudit", () => {
  it("records who did what, where, against which server", async () => {
    await recordAdminAction({
      action: "server stop",
      server: "survival",
      by: "admin#0001",
      byId: "111",
      guildId: "guildA",
    });

    expect(saveJson).toHaveBeenCalledTimes(1);
    const [, payload] = vi.mocked(saveJson).mock.calls[0]!;
    const entries = (payload as { entries: AdminAuditEntry[] }).entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      at: "2026-07-03 12:00:00",
      action: "server stop",
      server: "survival",
      by: "admin#0001",
      byId: "111",
      guildId: "guildA",
    });
  });

  it("appends to existing entries and preserves order", async () => {
    vi.mocked(loadJson).mockResolvedValue({
      entries: [{ at: "x", action: "server start", server: "s", by: "a", byId: "1", guildId: null }],
    });
    await recordAdminAction({
      action: "config reload",
      by: "op#0002",
      byId: "222",
    });
    const [, payload] = vi.mocked(saveJson).mock.calls[0]!;
    const entries = (payload as { entries: AdminAuditEntry[] }).entries;
    expect(entries).toHaveLength(2);
    expect(entries[1]!.action).toBe("config reload");
    expect(entries[1]!.server).toBeNull();
  });

  it("caps the log at 500 entries (bounded growth)", async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      at: "t",
      action: `a${i}`,
      server: null,
      by: "x",
      byId: "y",
      guildId: null,
    }));
    vi.mocked(loadJson).mockResolvedValue({ entries: many });
    await recordAdminAction({ action: "newest", by: "x", byId: "y" });
    const [, payload] = vi.mocked(saveJson).mock.calls[0]!;
    const entries = (payload as { entries: AdminAuditEntry[] }).entries;
    expect(entries).toHaveLength(500);
    expect(entries[entries.length - 1]!.action).toBe("newest");
    expect(entries[0]!.action).toBe("a1"); // oldest entry dropped
  });

  it("never throws — audit failure must not block the admin action", async () => {
    vi.mocked(saveJson).mockRejectedValue(new Error("disk full"));
    await expect(
      recordAdminAction({ action: "server stop", by: "x", byId: "y" }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });

  it("loadAdminAudit tolerates a missing/foreign-shaped store", async () => {
    vi.mocked(loadJson).mockResolvedValue({});
    expect(await loadAdminAudit()).toEqual([]);
    vi.mocked(loadJson).mockResolvedValue({ entries: "not-an-array" });
    expect(await loadAdminAudit()).toEqual([]);
  });
});
