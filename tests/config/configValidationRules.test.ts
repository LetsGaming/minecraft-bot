/**
 * Pins the numeric, format and locale rules of validateCandidateConfig by the
 * field each one reports, whether the schema or a hand-written check
 * enforces it.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { validateCandidateConfig } from "../../src/core/config.js";

const base = {
  token: "t",
  clientId: "c",
  servers: { a: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } },
};

const plain = (line: string): string => line.replace(/[\u2013\u2014]/g, "-");

const errorsOf = (extra: object): string =>
  validateCandidateConfig({ ...base, ...extra }).errors.join("\n");

describe("guild language", () => {
  it("accepts en and de", () => {
    for (const language of ["en", "de"]) {
      const r = validateCandidateConfig({ ...base, guilds: { "1": { language } } });
      expect(r.valid).toBe(true);
      expect(r.warnings.join("\n")).not.toContain("locale");
    }
  });

  it("warns, without failing, on an unknown locale", () => {
    const r = validateCandidateConfig({ ...base, guilds: { "1": { language: "fr" } } });
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).toContain(
      'guilds.1.language "fr" is not a known locale (en, de)',
    );
  });
});

describe("server ids", () => {
  const serverWith = (id: string): object => ({
    servers: { [id]: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } },
  });

  it('rejects an id containing ":"', () => {
    expect(plain(errorsOf(serverWith("a:b")))).toContain("servers.a:b: the id must not contain");
  });

  it("rejects an id longer than fits a component id", () => {
    expect(errorsOf(serverWith("x".repeat(33)))).toContain("at most 32 characters");
  });

  it("accepts an ordinary id", () => {
    expect(errorsOf(serverWith("survival-2"))).not.toContain("the id must not");
  });
});

describe("empty allowedServers", () => {
  it("warns that a multi-guild guild with an empty list can target nothing", () => {
    const r = validateCandidateConfig({
      ...base,
      guilds: { "1": { allowedServers: [] }, "2": { defaultServer: "a" } },
    });
    expect(r.warnings.join("\n")).toContain("guilds.1: allowedServers is empty");
  });

  it("does not warn when the guild still has a default server", () => {
    const r = validateCandidateConfig({
      ...base,
      guilds: {
        "1": { allowedServers: [], defaultServer: "a" },
        "2": { defaultServer: "a" },
      },
    });
    expect(r.warnings.join("\n")).not.toContain("allowedServers is empty");
  });
});

describe("waypoints.maxPerServer", () => {
  it.each([0, -1, 1.5])("rejects %s", (maxPerServer) => {
    expect(errorsOf({ waypoints: { maxPerServer } })).toContain(
      "waypoints.maxPerServer",
    );
  });
  it("accepts a positive integer", () => {
    expect(errorsOf({ waypoints: { maxPerServer: 25 } })).toBe("");
  });
});

describe("webui.port", () => {
  it.each([0, 70000, 80.5, -3])("rejects %s", (port) => {
    expect(errorsOf({ webui: { port } })).toContain("webui.port");
  });
  it.each([1, 8130, 65535])("accepts %s", (port) => {
    expect(errorsOf({ webui: { port } })).toBe("");
  });
});

describe("milestones", () => {
  it.each([[[10, -5]], [[0]], ["x"]])("rejects %j", (list) => {
    expect(errorsOf({ milestones: { "minecraft:mined": list } })).toContain(
      "milestones.minecraft:mined",
    );
  });
  it("accepts positive thresholds", () => {
    expect(errorsOf({ milestones: { playtime: [100, 5000.5] } })).toBe("");
  });
});

describe("schedules restart", () => {
  const restart = (r: object) => errorsOf({ schedules: { a: { restart: r } } });

  it.each(["25:00", "7:30", "12:60", "noon", ""])("rejects time %j", (time) => {
    expect(restart({ time })).toContain("schedules.a.restart.time");
  });
  it.each(["00:00", "07:30", "23:59"])("accepts time %j", (time) => {
    expect(restart({ time })).toBe("");
  });
  it("rejects bad day codes and accepts either case", () => {
    expect(restart({ time: "04:00", days: ["XX"] })).toContain("restart.days");
    expect(restart({ time: "04:00", days: ["mo", "FR"] })).toBe("");
  });
  it("rejects non-positive warnMinutes", () => {
    expect(restart({ time: "04:00", warnMinutes: [5, 0] })).toContain(
      "restart.warnMinutes",
    );
    expect(restart({ time: "04:00", warnMinutes: [15, 5, 1] })).toBe("");
  });
});

describe("validateCandidateConfig semantic output", () => {
  it("reports semantic errors and warnings across sections in a stable order", () => {
    const result = validateCandidateConfig({
      token: "t",
      clientId: "c",
      servers: {
        a: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" },
        b: { apiUrl: "http://10.0.0.5:3030", apiKey: "k" },
      },
      guilds: {
        "1": {
          language: "fr",
          linkedRole: "nope",
          whitelistApplications: { channelId: "5" },
          notifications: { channelId: "9", events: [] },
          allowedServers: ["a", "ghost"],
          chatBridge: { channelId: "7" },
        },
        "2": { defaultServer: "a" },
      },
      presence: { server: "ghost" },
      schedules: { ghost: { restart: { time: "04:00", days: ["XX"] } } },
    });
    expect({
      ...result,
      errors: result.errors.map(plain),
      warnings: result.warnings.map(plain),
    }).toMatchInlineSnapshot(`
      {
        "errors": [
          "  - guilds.1.chatBridge (channel 7): multiple servers are configured - set "server" on the bridge (or a guild "defaultServer") so the channel is bound to exactly one server.",
          "  - schedules.ghost.restart.days: must be an array of "SU".."SA"",
        ],
        "valid": false,
        "warnings": [
          "servers.a: apiUrl "http://127.0.0.1:3030" uses plaintext HTTP. This is acceptable ONLY on a trusted LAN segment - the x-api-key and all server-control commands travel unencrypted. Use https:// if the wrapper is reachable beyond your local network.",
          "servers.b: apiUrl "http://10.0.0.5:3030" uses plaintext HTTP. This is acceptable ONLY on a trusted LAN segment - the x-api-key and all server-control commands travel unencrypted. Use https:// if the wrapper is reachable beyond your local network.",
          "guilds.1.language "fr" is not a known locale (en, de) - the global language will be used",
          "guilds.1.linkedRole "nope" does not look like a Discord ID (17-20 digits)",
          "guilds.1.whitelistApplications needs BOTH channelId and adminChannelId - the feature stays off until both are set",
          "guilds.1.notifications has a channel but an empty events list - no messages will be sent (omit "events" to use the default set)",
          "guilds.1.allowedServers references unknown server "ghost" (configured servers: a, b)",
          "presence.server references unknown server "ghost" (configured servers: a, b)",
          "schedules.ghost references unknown server "ghost" (configured servers: a, b)",
        ],
      }
    `);
  });
});

describe("structural errors stop the semantic pass", () => {
  it("reports schema violations before any meaning-level finding", () => {
    const result = validateCandidateConfig({
      ...base,
      waypoints: { maxPerServer: 0 },
      presence: { server: "ghost" },
    });
    expect(result.errors).toEqual(["  - waypoints.maxPerServer: must be >= 1"]);
    expect(result.warnings.join(" ")).not.toContain("ghost");
  });
});

describe("embedColors", () => {
  it("accepts strict hex values for known keys", () => {
    const r = validateCandidateConfig({
      ...base,
      embedColors: { reward: "#ff00aa", "rarity.epic": "#A855F7" },
    });
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).not.toContain("embedColors");
  });

  it("rejects values that are not #rrggbb", () => {
    expect(errorsOf({ embedColors: { reward: "pink" } })).toContain("embedColors.reward");
    expect(errorsOf({ embedColors: { death: "#abc" } })).toContain("embedColors.death");
  });

  it("warns about unknown keys instead of failing", () => {
    const r = validateCandidateConfig({ ...base, embedColors: { nonsense: "#ffffff" } });
    expect(r.valid).toBe(true);
    expect(r.warnings.join("\n")).toContain("embedColors.nonsense");
  });
});
