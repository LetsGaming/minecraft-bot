/**
 * Config validation — the programmatic entry point (validateCandidateConfig)
 * and the new multi-server rules:
 *   - chat bridges must be unambiguous (1 channel ↔ 1 server)
 *   - feature `server` scopes accept a string OR a list of IDs
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../src/common/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateCandidateConfig } from "../src/common/config.js";

const base = { token: "t", clientId: "c" };

describe("validateCandidateConfig — basics", () => {
  it("rejects a non-object root", () => {
    for (const candidate of [null, [], "nope", 42]) {
      const result = validateCandidateConfig(candidate);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("config root");
    }
  });

  it("accepts a minimal config and reports missing token/clientId", () => {
    expect(validateCandidateConfig(base).valid).toBe(true);

    const missing = validateCandidateConfig({ token: "t" });
    expect(missing.valid).toBe(false);
    expect(missing.errors.join("\n")).toContain("clientId");
  });
});

describe("validateCandidateConfig — chat bridge rules", () => {
  const twoServers = { a: {}, b: {} };

  it("errors when a bridge is ambiguous (multi-server, no pin, no default)", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: twoServers,
      guilds: { g1: { chatBridge: { channelId: "ch1" } } },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain("chatBridge");
    expect(result.errors.join("\n")).toContain("exactly one server");
  });

  it("accepts an unpinned bridge when the guild has a defaultServer", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: twoServers,
      guilds: {
        g1: { defaultServer: "a", chatBridge: { channelId: "ch1" } },
      },
    });
    expect(result.valid).toBe(true);
  });

  it("accepts an unpinned bridge when only one server is configured", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: { only: {} },
      guilds: { g1: { chatBridge: { channelId: "ch1" } } },
    });
    expect(result.valid).toBe(true);
  });

  it("errors when one channel is bound to two different servers", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: twoServers,
      guilds: {
        g1: {
          chatBridge: [
            { channelId: "ch1", server: "a" },
            { channelId: "ch1", server: "b" },
          ],
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain('"a"');
    expect(result.errors.join("\n")).toContain('"b"');
  });

  it("accepts the recommended one-channel-per-server array form", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: twoServers,
      guilds: {
        g1: {
          chatBridge: [
            { channelId: "ch1", server: "a" },
            { channelId: "ch2", server: "b" },
          ],
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe("validateCandidateConfig — server scope lists", () => {
  it("warns about unknown server IDs inside a scope array", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: { a: {}, b: {} },
      guilds: {
        g1: {
          defaultServer: "a",
          notifications: { channelId: "n1", server: ["a", "ghost"] },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.join("\n")).toContain('"ghost"');
    expect(result.warnings.join("\n")).toContain("notifications.server");
  });

  it("does not warn when every listed server exists", () => {
    const result = validateCandidateConfig({
      ...base,
      servers: { a: {}, b: {} },
      guilds: {
        g1: {
          defaultServer: "a",
          tpsAlerts: { channelId: "t1", server: ["a", "b"] },
        },
      },
    });
    expect(result.valid).toBe(true);
    expect(
      result.warnings.filter((w) => w.includes("tpsAlerts")),
    ).toHaveLength(0);
  });
});
