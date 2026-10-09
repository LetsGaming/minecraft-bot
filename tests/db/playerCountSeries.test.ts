import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "pcount-test-"));
vi.mock("../../src/core/utils/paths.js", () => ({ getRootDir: () => dbDir }));
vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getDb, closeDbForTesting } from "../../src/core/db/index.js";
import { loadPlayerCountSeries } from "../../src/core/utils/stores/playerCountHistory.js";

const HOUR = 3_600_000;
const BASE = 1_800_000_000_000 - (1_800_000_000_000 % HOUR);

function insert(server: string, h: number): void {
  getDb()
    .prepare(
      "INSERT INTO player_count_hours (server_id, h, sum, max, samples) VALUES (?, ?, 4, 3, 2)",
    )
    .run(server, h);
}

beforeEach(() => {
  getDb().prepare("DELETE FROM player_count_hours").run();
});

afterAll(() => {
  closeDbForTesting();
  fs.rmSync(dbDir, { recursive: true, force: true });
});

describe("loadPlayerCountSeries", () => {
  it("returns only the server's buckets at or after the start, oldest first", () => {
    insert("smp", BASE - 3 * HOUR);
    insert("smp", BASE - HOUR);
    insert("smp", BASE);
    insert("other", BASE);
    const series = loadPlayerCountSeries("smp", BASE - HOUR);
    expect(series.map((b) => b.h)).toEqual([BASE - HOUR, BASE]);
    expect(series[0]).toEqual({ h: BASE - HOUR, sum: 4, max: 3, samples: 2 });
  });

  it("returns an empty series for an unknown server", () => {
    expect(loadPlayerCountSeries("none", 0)).toEqual([]);
  });
});
