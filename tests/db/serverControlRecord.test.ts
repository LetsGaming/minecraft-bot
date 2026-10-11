import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/core/utils/jsonStore.js", () => ({
  loadJson: vi.fn().mockResolvedValue({}),
  saveJson: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../src/core/utils/paths.js", () => ({
  getRootDir: vi.fn().mockReturnValue("/tmp"),
}));

import { closeDbForTesting, getDb } from "../../src/core/db/index.js";
import { lastOnlineStreakStart } from "../../src/core/utils/stores/uptimeTracker.js";
import {
  controlActionBehindDowntime,
  lastControlAction,
  recordControlAction,
} from "../../src/core/utils/stores/serverControlRecord.js";

function checks(serverId: string, rows: Array<[t: number, up: 0 | 1]>): void {
  const insert = getDb().prepare("INSERT INTO uptime_checks (server_id, t, up) VALUES (?, ?, ?)");
  for (const [t, up] of rows) insert.run(serverId, t, up);
}

const stop = (at: number) => ({ kind: "stop" as const, by: "marlene", byId: "u1", at });

beforeEach(() => {
  closeDbForTesting();
});

describe("lastOnlineStreakStart", () => {
  it("is null for a server never seen online", () => {
    checks("smp", [[100, 0], [200, 0]]);
    expect(lastOnlineStreakStart("smp")).toBeNull();
  });

  it("finds the start of the latest online period", () => {
    checks("smp", [[100, 1], [200, 0], [300, 1], [400, 1], [500, 0]]);
    expect(lastOnlineStreakStart("smp")).toBe(300);
  });
});

describe("serverControlRecord", () => {
  it("keeps one record per server and survives a reload", () => {
    recordControlAction("smp", stop(1000));
    recordControlAction("creative", { ...stop(2000), kind: "restart" });
    expect(lastControlAction("smp")).toEqual(stop(1000));
    expect(lastControlAction("creative")?.kind).toBe("restart");
    expect(lastControlAction("other")).toBeNull();
  });

  it("explains the downtime when it falls in the last online period", () => {
    checks("smp", [[100, 1], [200, 1], [300, 0]]);
    recordControlAction("smp", stop(250));
    expect(controlActionBehindDowntime("smp")).toEqual(stop(250));
  });

  it("is ignored once the server came back after it", () => {
    checks("smp", [[100, 1], [300, 0], [400, 1], [500, 0]]);
    recordControlAction("smp", stop(250));
    expect(controlActionBehindDowntime("smp")).toBeNull();
  });

  it("applies when there is no uptime history", () => {
    recordControlAction("smp", stop(250));
    expect(controlActionBehindDowntime("smp")).toEqual(stop(250));
  });
});
