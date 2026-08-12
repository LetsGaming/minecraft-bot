import { describe, it, expect, beforeEach } from "vitest";
import {
  remember,
  recall,
  readThrough,
  forget,
  clearLastKnown,
} from "../../src/core/utils/wrapper/lastKnown.js";

beforeEach(() => clearLastKnown());

describe("readThrough", () => {
  it("returns live data and reports no staleness", async () => {
    const res = await readThrough("smp", "configIndex", async () => ["a.toml"]);
    expect(res.value).toEqual(["a.toml"]);
    expect(res.stale).toBeNull();
  });

  it("falls back to the last successful read when the wrapper fails", async () => {
    await readThrough("smp", "configIndex", async () => ["a.toml"]);
    const res = await readThrough("smp", "configIndex", () => {
      throw new Error("ECONNREFUSED");
    });
    expect(res.value).toEqual(["a.toml"]);
    expect(res.stale?.reason).toBe("ECONNREFUSED");
    expect(res.stale?.asOf).toBeLessThanOrEqual(Date.now());
  });

  it("rethrows when there is nothing to fall back to", async () => {
    // A first-ever read of an unreachable server must report the problem
    // rather than invent an empty result.
    await expect(
      readThrough("smp", "configIndex", () => {
        throw new Error("ECONNREFUSED");
      }),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("never caches a failed read", async () => {
    await readThrough("smp", "configIndex", async () => ["a.toml"]);
    await readThrough("smp", "configIndex", () => {
      throw new Error("boom");
    });
    // The failure must not have replaced the good value with anything.
    const again = await readThrough("smp", "configIndex", () => {
      throw new Error("boom again");
    });
    expect(again.value).toEqual(["a.toml"]);
  });

  it("keeps servers and resources separate", async () => {
    await readThrough("smp", "configIndex", async () => ["smp.toml"]);
    await expect(
      readThrough("creative", "configIndex", () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
    await expect(
      readThrough("smp", "backupIndex", () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });
});

describe("forget", () => {
  it("drops an entry so a superseded value cannot be served", async () => {
    await readThrough("smp", "configFile:x", async () => "old");
    forget("smp", "configFile:x");
    await expect(
      readThrough("smp", "configFile:x", () => {
        throw new Error("down");
      }),
    ).rejects.toThrow("down");
  });

  it("drops every resource for a server when no resource is named", async () => {
    await readThrough("smp", "configIndex", async () => ["a"]);
    await readThrough("smp", "backupIndex", async () => ["b"]);
    await readThrough("creative", "configIndex", async () => ["c"]);
    forget("smp");
    expect(recall("smp", "configIndex", "x")).toBeUndefined();
    expect(recall("smp", "backupIndex", "x")).toBeUndefined();
    // Another server's cache is untouched.
    expect(recall("creative", "configIndex", "x")?.value).toEqual(["c"]);
  });
});

describe("recall", () => {
  it("expires an entry that is older than the window", () => {
    remember("smp", "configIndex", ["a"]);
    const sevenHoursOn = Date.now() + 7 * 60 * 60 * 1000;
    // Past the window "last known" stops being information.
    expect(recall("smp", "configIndex", "x", sevenHoursOn)).toBeUndefined();
  });

  it("serves an entry inside the window", () => {
    remember("smp", "configIndex", ["a"]);
    const oneHourOn = Date.now() + 60 * 60 * 1000;
    expect(recall("smp", "configIndex", "x", oneHourOn)?.value).toEqual(["a"]);
  });
});
