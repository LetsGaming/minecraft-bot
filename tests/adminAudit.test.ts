/**
 * adminAudit.test.ts — SQLite-backed admin audit log.
 *
 * Runs against a real in-memory database (tests/setup.ts). This store is
 * the reason the DB layer exists: both processes append to it, and the
 * JSON version could drop entries under a cross-process race.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { log } from "../src/core/utils/logger.js";
import { closeDbForTesting } from "../src/core/db/index.js";
import {
  loadAdminAudit,
  recordAdminAction,
} from "../src/core/utils/adminAudit.js";

beforeEach(() => {
  vi.clearAllMocks();
  closeDbForTesting();
});

afterEach(() => {
  process.env.MCBOT_DB_PATH = ":memory:";
  closeDbForTesting();
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

    const entries = await loadAdminAudit();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({
      at: "2026-07-03 12:00:00",
      action: "server stop",
      server: "survival",
      by: "admin#0001",
      byId: "111",
      guildId: "guildA",
    });
  });

  it("defaults server/guildId to null and keeps detail when given", async () => {
    await recordAdminAction({
      action: "config write",
      by: "web:admin",
      byId: "222",
      detail: "2 keys changed",
    });
    const [entry] = await loadAdminAudit();
    expect(entry!.server).toBeNull();
    expect(entry!.guildId).toBeNull();
    expect(entry!.detail).toBe("2 keys changed");
  });

  it("returns entries oldest-first, like the old JSON array", async () => {
    await recordAdminAction({ action: "first", by: "a", byId: "1" });
    await recordAdminAction({ action: "second", by: "a", byId: "1" });
    const entries = await loadAdminAudit();
    expect(entries.map((e) => e.action)).toEqual(["first", "second"]);
  });

  it("caps retention at 500 entries, dropping the oldest", async () => {
    for (let i = 0; i < 505; i++) {
      await recordAdminAction({ action: `a${i}`, by: "x", byId: "1" });
    }
    const entries = await loadAdminAudit();
    expect(entries).toHaveLength(500);
    expect(entries[0]!.action).toBe("a5");
    expect(entries[499]!.action).toBe("a504");
  });

  it("never throws when the store is unusable — logs instead", async () => {
    // Point the store somewhere it cannot possibly open.
    closeDbForTesting();
    process.env.MCBOT_DB_PATH = "/proc/nonexistent/nope/bot.db";

    await expect(
      recordAdminAction({ action: "server stop", by: "a", byId: "1" }),
    ).resolves.toBeUndefined();
    expect(vi.mocked(log.error)).toHaveBeenCalledWith(
      "adminAudit",
      expect.stringContaining('Failed to record "server stop"'),
    );
  });
});
