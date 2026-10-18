/**
 * Database lifecycle: the VACUUM opt-in flag, closing the handle when init
 * fails, a real closeDb(), and the driver's error hint.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const opened = vi.hoisted(() => ({ closes: [] as Array<ReturnType<typeof vi.fn>> }));
const importFailure = vi.hoisted(() => ({ error: null as Error | null }));

vi.mock("../../src/core/db/driver.js", async (orig) => {
  const mod = await orig<typeof import("../../src/core/db/driver.js")>();
  return {
    ...mod,
    openDatabase: (p: string) => {
      const db = mod.openDatabase(p);
      const realClose = db.close.bind(db);
      const close = vi.fn(realClose);
      opened.closes.push(close);
      db.close = close;
      return db;
    },
  };
});

vi.mock("../../src/core/db/importLegacy.js", () => ({
  importLegacyJson: () => {
    if (importFailure.error) throw importFailure.error;
  },
}));

import { closeDb, closeDbForTesting, getDb } from "../../src/core/db/index.js";
import { openDatabase } from "../../src/core/db/driver.js";
import { log } from "../../src/core/utils/logger.js";

let dir: string;
const originalDbPath = process.env.MCBOT_DB_PATH;
const originalVacuum = process.env.MCBOT_VACUUM_ON_START;

beforeEach(() => {
  closeDbForTesting();
  opened.closes.length = 0;
  importFailure.error = null;
  vi.mocked(log.info).mockClear();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mcbot-lifecycle-"));
  process.env.MCBOT_DB_PATH = path.join(dir, "bot.db");
});

afterEach(() => {
  closeDbForTesting();
  process.env.MCBOT_DB_PATH = originalDbPath;
  if (originalVacuum === undefined) delete process.env.MCBOT_VACUUM_ON_START;
  else process.env.MCBOT_VACUUM_ON_START = originalVacuum;
  fs.rmSync(dir, { recursive: true, force: true });
});

const vacuumLogged = (): boolean =>
  vi.mocked(log.info).mock.calls.some(([, msg]) => String(msg).includes("running VACUUM"));

describe("MCBOT_VACUUM_ON_START", () => {
  it.each(["0", "false", ""])("does not vacuum for %j", (value) => {
    process.env.MCBOT_VACUUM_ON_START = value;
    getDb();
    expect(vacuumLogged()).toBe(false);
  });

  it("vacuums only for exactly 1", () => {
    process.env.MCBOT_VACUUM_ON_START = "1";
    getDb();
    expect(vacuumLogged()).toBe(true);
  });
});

describe("init failure", () => {
  it("closes the opened handle and lets a retry succeed", () => {
    importFailure.error = new Error("import blew up");
    expect(() => getDb()).toThrow("import blew up");
    expect(opened.closes).toHaveLength(1);
    expect(opened.closes[0]).toHaveBeenCalledTimes(1);

    importFailure.error = null;
    expect(() => getDb()).not.toThrow();
    expect(opened.closes).toHaveLength(2);
  });
});

describe("closeDb", () => {
  it("closes the handle and a later getDb opens a fresh one", () => {
    getDb();
    closeDb();
    expect(opened.closes[0]).toHaveBeenCalledTimes(1);
    getDb();
    expect(opened.closes).toHaveLength(2);
  });

  it("is safe when nothing is open", () => {
    expect(() => closeDb()).not.toThrow();
  });
});

describe("driver error hint", () => {
  it("does not suggest npm rebuild when the database cannot be opened", () => {
    const missing = path.join(dir, "no-such-dir", "bot.db");
    let message = "";
    try {
      openDatabase(missing);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    expect(message).not.toContain("npm rebuild");
    expect(message).toContain(missing);
  });
});
