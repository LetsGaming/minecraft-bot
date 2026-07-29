/**
 * Command usage counters — the data behind the dashboard's "not used in 30
 * days" column and /help's "you have not tried this yet".
 *
 * The recording path must never throw: a failed metric that fails the
 * command it was measuring is worse than no metric at all.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-test-"));
vi.mock("../../src/core/utils/paths.js", () => ({ getRootDir: () => dbDir }));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDb, closeDbForTesting } from "../../src/core/db/index.js";
import {
  recordCommandUsage,
  usageByCommand,
  commandsUsedBy,
  pruneCommandUsage,
  USAGE_RETENTION_DAYS,
} from "../../src/core/utils/commands/commandUsage.js";

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;

beforeEach(() => {
  getDb().prepare("DELETE FROM command_usage").run();
});

afterAll(() => {
  closeDbForTesting();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("recordCommandUsage", () => {
  it("records a slash invocation", () => {
    recordCommandUsage(
      { command: "daily", surface: "slash", userId: "u1", guildId: "g1" },
      NOW,
    );
    expect(usageByCommand(30, NOW)).toEqual([
      {
        command: "daily",
        surface: "slash",
        count: 1,
        users: 1,
        lastUsedAt: NOW,
      },
    ]);
  });

  it("records in-game use with no linked account", () => {
    // Plenty of players use !commands without ever linking. Those uses
    // still count for the dashboard even though they cannot count for /help.
    recordCommandUsage(
      { command: "seed", surface: "ingame", userId: null, serverId: "survival" },
      NOW,
    );
    const row = usageByCommand(30, NOW)[0];
    expect(row?.count).toBe(1);
    expect(row?.users).toBe(0);
  });
});

describe("usageByCommand", () => {
  it("counts uses and distinct people separately", () => {
    // One enthusiast running a command ten times is not adoption, and the
    // dashboard has to be able to tell the difference.
    for (let i = 0; i < 10; i++) {
      recordCommandUsage({ command: "stats", surface: "slash", userId: "u1" }, NOW);
    }
    recordCommandUsage({ command: "stats", surface: "slash", userId: "u2" }, NOW);

    const row = usageByCommand(30, NOW)[0];
    expect(row?.count).toBe(11);
    expect(row?.users).toBe(2);
  });

  it("ignores anything older than the window", () => {
    recordCommandUsage({ command: "old", surface: "slash", userId: "u1" }, NOW - 40 * DAY);
    recordCommandUsage({ command: "new", surface: "slash", userId: "u1" }, NOW - 5 * DAY);
    expect(usageByCommand(30, NOW).map((r) => r.command)).toEqual(["new"]);
  });

  it("omits commands with no rows, so the caller's zero is a real zero", () => {
    expect(usageByCommand(30, NOW)).toEqual([]);
  });

  it("orders by use count, busiest first", () => {
    recordCommandUsage({ command: "rare", surface: "slash", userId: "u1" }, NOW);
    for (let i = 0; i < 5; i++) {
      recordCommandUsage({ command: "popular", surface: "slash", userId: "u1" }, NOW);
    }
    expect(usageByCommand(30, NOW).map((r) => r.command)).toEqual([
      "popular",
      "rare",
    ]);
  });
});

describe("commandsUsedBy", () => {
  it("returns what this user has run, and nothing others have", () => {
    recordCommandUsage({ command: "daily", surface: "slash", userId: "u1" }, NOW);
    recordCommandUsage({ command: "stats", surface: "slash", userId: "u2" }, NOW);

    expect(commandsUsedBy("u1")).toEqual(new Set(["daily"]));
    expect(commandsUsedBy("u3")).toEqual(new Set());
  });

  it("is not windowed — something tried once long ago has still been seen", () => {
    recordCommandUsage(
      { command: "seed", surface: "slash", userId: "u1" },
      NOW - 200 * DAY,
    );
    expect(commandsUsedBy("u1").has("seed")).toBe(true);
  });
});

describe("pruneCommandUsage", () => {
  it("drops rows past the retention window and keeps the rest", () => {
    recordCommandUsage(
      { command: "ancient", surface: "slash", userId: "u1" },
      NOW - (USAGE_RETENTION_DAYS + 1) * DAY,
    );
    recordCommandUsage({ command: "recent", surface: "slash", userId: "u1" }, NOW);

    expect(pruneCommandUsage(NOW)).toBe(1);
    expect(commandsUsedBy("u1")).toEqual(new Set(["recent"]));
  });
});
