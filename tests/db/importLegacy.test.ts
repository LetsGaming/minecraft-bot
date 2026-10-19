/**
 * Characterization tests for the one-time legacy JSON import that runs when
 * the database is first opened: table-empty guard, file retirement,
 * corrupt-file handling and per-store filtering rules.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const root = vi.hoisted(() => ({ dir: "" }));
vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: () => root.dir,
}));

import { getDb, closeDbForTesting } from "../../src/core/db/index.js";
import { kvGet, kvSet } from "../../src/core/db/kv.js";
import { log } from "../../src/core/utils/logger.js";

let dataDir: string;
const originalDbPath = process.env.MCBOT_DB_PATH;

beforeEach(() => {
  closeDbForTesting();
  root.dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-import-"));
  dataDir = path.join(root.dir, "data");
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.MCBOT_DB_PATH = path.join(dataDir, "bot.db");
  vi.mocked(log.warn).mockClear();
});
afterEach(() => {
  closeDbForTesting();
  process.env.MCBOT_DB_PATH = originalDbPath;
  fs.rmSync(root.dir, { recursive: true, force: true });
});

function legacy(file: string, content: unknown): void {
  fs.writeFileSync(
    path.join(dataDir, file),
    typeof content === "string" ? content : JSON.stringify(content),
  );
}
const exists = (file: string) => fs.existsSync(path.join(dataDir, file));
function rows(sql: string): Array<Record<string, unknown>> {
  return getDb().prepare(sql).all() as Array<Record<string, unknown>>;
}

describe("importLegacyJson", () => {
  it("does nothing when no legacy files exist", () => {
    expect(rows("SELECT * FROM admin_audit")).toEqual([]);
    expect(fs.readdirSync(dataDir).filter((f) => f.endsWith(".json"))).toEqual([]);
  });

  it("never imports into an in-memory database", () => {
    closeDbForTesting();
    process.env.MCBOT_DB_PATH = ":memory:";
    legacy("linkedAccounts.json", { "1": "Steve" });
    expect(rows("SELECT * FROM linked_accounts")).toEqual([]);
    expect(exists("linkedAccounts.json")).toBe(true);
  });

  it("imports adminAudit entries with defaults and retires the file and its backup", () => {
    legacy("adminAudit.json", {
      entries: [
        { at: "t1", action: "ban", server: "smp", by: "a#1", byId: "1", guildId: "g", detail: "d" },
        { action: "kick" },
      ],
    });
    legacy("adminAudit.json.bak", { entries: [] });
    const out = rows("SELECT * FROM admin_audit ORDER BY rowid");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ at: "t1", action: "ban", server: "smp", by_tag: "a#1", guild_id: "g" });
    expect(out[1]).toMatchObject({ at: "", action: "kick", server: null, by_tag: "", detail: null });
    expect(exists("adminAudit.json")).toBe(false);
    expect(exists("adminAudit.json.imported")).toBe(true);
    expect(exists("adminAudit.json.bak")).toBe(false);
    expect(exists("adminAudit.json.bak.imported")).toBe(true);
  });

  it("ignores an adminAudit file without an entries array and leaves it in place", () => {
    legacy("adminAudit.json", { entries: "nope" });
    expect(rows("SELECT * FROM admin_audit")).toEqual([]);
    expect(exists("adminAudit.json")).toBe(true);
  });

  it("imports whitelist audit keyed lowercase and skips non-object values", () => {
    legacy("whitelistAudit.json", {
      Steve: { username: "Steve", uuid: "u1", addedBy: "A", addedAt: "now", removedBy: "B" },
      bogus: "str",
      nul: null,
    });
    const out = rows("SELECT * FROM whitelist_audit");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ username_lower: "steve", uuid: "u1", added_by: "A", removed_by: "B" });
  });

  it("imports linked accounts, skipping non-string names", () => {
    legacy("linkedAccounts.json", { "1": "Steve", "2": 5, "3": null });
    expect(rows("SELECT * FROM linked_accounts")).toEqual([
      expect.objectContaining({ discord_id: "1", mc_name: "Steve" }),
    ]);
  });

  it("imports only unexpired, well-formed link codes", () => {
    legacy("linkCodes.json", {
      live: { discordId: "1", expires: Date.now() + 60_000, confirmed: true },
      stale: { discordId: "2", expires: Date.now() - 1 },
      noExpiry: { discordId: "3" },
      junk: "x",
    });
    const out = rows("SELECT * FROM link_codes");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ code: "live", discord_id: "1", confirmed: 1 });
    expect(exists("linkCodes.json.imported")).toBe(true);
  });

  it("skips rows the database refuses instead of failing startup (AUD-032)", () => {
    // Two keys that collide once lowercased, and a link code without an owner.
    legacy("whitelistAudit.json", {
      Steve: { username: "Steve", addedBy: "A" },
      steve: { username: "steve", addedBy: "B" },
    });
    legacy("linkCodes.json", {
      orphan: { expires: Date.now() + 60_000 },
      live: { discordId: "1", expires: Date.now() + 60_000 },
    });
    expect(rows("SELECT * FROM whitelist_audit")).toHaveLength(1);
    expect(rows("SELECT code FROM link_codes")).toEqual([{ code: "live" }]);
    expect(exists("whitelistAudit.json.imported")).toBe(true);
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith("db", expect.stringContaining("skipped entry"));
  });

  it("stores versioned blobs verbatim in kv_store and retires the file", () => {
    legacy("polls.json", { version: 1, polls: [] });
    legacy("challenges.json", { anything: [1, 2, 3] });
    legacy("sessions.json", "[1,2]");
    expect(kvGet("polls")).toEqual({ version: 1, polls: [] });
    expect(kvGet("challenges")).toEqual({ anything: [1, 2, 3] });
    expect(kvGet("sessions")).toEqual([1, 2]);
    expect(exists("polls.json")).toBe(false);
    expect(exists("polls.json.imported")).toBe(true);
  });

  it("does not import scalars or null as blobs and does not retire them", () => {
    legacy("watches.json", "5");
    legacy("waypoints.json", "null");
    expect(kvGet("watches")).toBeNull();
    expect(kvGet("waypoints")).toBeNull();
    expect(exists("watches.json")).toBe(true);
  });

  it("imports uptime checks and hourly player counts, skipping malformed rows", () => {
    legacy("uptimeHistory.json", {
      smp: [{ t: 1, up: 1 }, { t: 2, up: 0 }, { up: 1 }, null],
      broken: "x",
    });
    legacy("playerCounts.json", {
      servers: {
        smp: [{ h: 10, sum: 5, max: 3, samples: 2 }, { h: 10, sum: 99 }, { sum: 1 }, { h: 11 }],
      },
    });
    expect(rows("SELECT * FROM uptime_checks ORDER BY t")).toEqual([
      expect.objectContaining({ server_id: "smp", t: 1, up: 1 }),
      expect.objectContaining({ server_id: "smp", t: 2, up: 0 }),
    ]);
    const counts = rows("SELECT * FROM player_count_hours ORDER BY h");
    expect(counts).toHaveLength(2);
    expect(counts[0]).toMatchObject({ h: 10, sum: 5, max: 3, samples: 2 });
    expect(counts[1]).toMatchObject({ h: 11, sum: 0, max: 0, samples: 0 });
  });

  it("leaves a corrupt legacy file in place and warns instead of failing startup", () => {
    legacy("adminAudit.json", "{not json");
    legacy("linkedAccounts.json", { "1": "Steve" });
    expect(rows("SELECT * FROM linked_accounts")).toHaveLength(1);
    expect(rows("SELECT * FROM admin_audit")).toEqual([]);
    expect(exists("adminAudit.json")).toBe(true);
    expect(exists("adminAudit.json.imported")).toBe(false);
    expect(log.warn).toHaveBeenCalled();
  });

  it("leaves the file in place and warns when its table already has rows", () => {
    getDb().prepare("INSERT INTO linked_accounts (discord_id, mc_name) VALUES ('9', 'Existing')").run();
    kvSet("polls", { version: 1, polls: ["existing"] });

    legacy("linkedAccounts.json", { "1": "Steve" });
    legacy("polls.json", { version: 1, polls: ["legacy"] });
    // The import only runs on open, so re-run it directly on the live handle.
    return import("../../src/core/db/importLegacy.js").then(({ importLegacyJson }) => {
      importLegacyJson(getDb());
      expect(rows("SELECT * FROM linked_accounts")).toEqual([
        expect.objectContaining({ discord_id: "9" }),
      ]);
      expect(kvGet("polls")).toEqual({ version: 1, polls: ["existing"] });
      expect(exists("linkedAccounts.json")).toBe(true);
      expect(exists("linkedAccounts.json.imported")).toBe(false);
      expect(exists("polls.json")).toBe(true);
      expect(exists("polls.json.imported")).toBe(false);
      expect(log.warn).toHaveBeenCalledWith(
        "db",
        expect.stringContaining("linkedAccounts.json not imported"),
      );
    });
  });

  it("is idempotent: a second run finds nothing left to import", () => {
    legacy("linkedAccounts.json", { "1": "Steve" });
    expect(rows("SELECT * FROM linked_accounts")).toHaveLength(1);
    return import("../../src/core/db/importLegacy.js").then(({ importLegacyJson }) => {
      importLegacyJson(getDb());
      expect(rows("SELECT * FROM linked_accounts")).toHaveLength(1);
    });
  });
});
