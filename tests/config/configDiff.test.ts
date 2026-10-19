import { describe, it, expect } from "vitest";
import { summarizeConfigChanges } from "../../src/core/utils/config/configDiff.js";
import { stableStringify } from "../../src/core/utils/config/stableStringify.js";
import { guildConfigHash } from "../../src/core/utils/config/guildConfigHash.js";

describe("summarizeConfigChanges top-level coverage", () => {
  it("reports timezone and schedules, which the old key list omitted", () => {
    const lines = summarizeConfigChanges(
      { timezone: "UTC", schedules: { a: { timezone: "UTC" } } } as never,
      { timezone: "Europe/Berlin", schedules: { a: { timezone: "Europe/Berlin" } } } as never,
    );
    expect(lines).toContain("timezone: UTC → Europe/Berlin");
    expect(lines).toContain("schedules changed");
  });

  it("never prints the token or diffs servers", () => {
    const lines = summarizeConfigChanges(
      { token: "old-secret", servers: { a: { apiKey: "1" } } } as never,
      { token: "new-secret", servers: { a: { apiKey: "2" } } } as never,
    );
    expect(lines).toEqual([]);
  });

  it("treats a block with reordered keys as unchanged", () => {
    const lines = summarizeConfigChanges(
      { presence: { enabled: true, format: "x" } } as never,
      { presence: { format: "x", enabled: true } } as never,
    );
    expect(lines).toEqual([]);
  });
});

describe("stableStringify", () => {
  it("is independent of key order at every depth but keeps array order", () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe(
      stableStringify({ a: { c: 2, d: 1 }, b: 1 }),
    );
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(undefined)).toBe("undefined");
  });

  it("backs the guild hash", () => {
    expect(guildConfigHash({ a: 1, b: 2 })).toBe(guildConfigHash({ b: 2, a: 1 }));
  });
});
