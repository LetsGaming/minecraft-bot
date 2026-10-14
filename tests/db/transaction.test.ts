/**
 * AUD-006: a BEGIN that fails (SQLITE_BUSY past busy_timeout) must not
 * leave the process unable to start any later transaction.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDb, withTransaction, closeDbForTesting } from "../../src/core/db/index.js";

afterEach(() => {
  vi.restoreAllMocks();
  closeDbForTesting();
});

describe("withTransaction", () => {
  it("still works after a BEGIN that failed", () => {
    const db = getDb();
    const real = db.exec.bind(db);
    const spy = vi.spyOn(db, "exec").mockImplementation((sql: string) => {
      if (sql === "BEGIN IMMEDIATE") throw new Error("database is locked");
      return real(sql);
    });
    expect(() => withTransaction(() => 1)).toThrow("database is locked");
    spy.mockRestore();
    expect(withTransaction(() => 2)).toBe(2);
  });
});
