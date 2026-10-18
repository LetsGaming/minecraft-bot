import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/core/utils/logger.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  allowedServerIdsIn,
  referencedServerIds,
} from "../../src/core/utils/server/guildTargets.js";
import { bridgesOf, guildServerScopes } from "../../src/core/utils/server/guildScopes.js";
import { validateCandidateConfig } from "../../src/core/config.js";
import type { GuildConfig } from "../../src/core/config.js";

const guilds = (g1: Partial<GuildConfig>): Record<string, GuildConfig> => ({
  g1: g1 as GuildConfig,
  g2: { defaultServer: "b" } as GuildConfig,
});

describe("allowedServerIdsIn", () => {
  it("treats an explicit empty allowedServers as deny-all", () => {
    const allowed = allowedServerIdsIn(guilds({ allowedServers: [] }), "g1");
    expect(allowed).not.toBeNull();
    expect(allowed!.size).toBe(0);
  });

  it("keeps the guild default reachable with an empty list", () => {
    const allowed = allowedServerIdsIn(
      guilds({ allowedServers: [], defaultServer: "a" }),
      "g1",
    );
    expect([...allowed!]).toEqual(["a"]);
  });

  it("stays unrestricted for a guild that references nothing and sets no list", () => {
    expect(allowedServerIdsIn(guilds({}), "g1")).toBeNull();
  });

  it("returns the listed servers", () => {
    const allowed = allowedServerIdsIn(guilds({ allowedServers: ["a"] }), "g1");
    expect([...allowed!]).toEqual(["a"]);
  });
});

describe("guildServerScopes consumers", () => {
  const full: GuildConfig = {
    defaultServer: "d",
    chatBridge: [
      { channelId: "1", server: "b1" },
      { channelId: "2", server: "b2" },
    ],
    notifications: { server: ["n1", "n2"] },
    leaderboard: { server: "l" },
    tpsAlerts: { server: "t" },
    downtimeAlerts: { server: ["x"] },
    reports: { server: "r" },
  } as unknown as GuildConfig;

  const known = { a: { apiUrl: "http://127.0.0.1:3030", apiKey: "k" } };
  const warningsFor = (guildMap: object): string =>
    validateCandidateConfig({
      token: "t",
      clientId: "c",
      servers: known,
      guilds: guildMap,
    } as never).warnings.join("\n");

  it("lists every field that names a server", () => {
    expect(guildServerScopes(full).map((s) => s.field)).toEqual([
      "defaultServer",
      "chatBridge.server",
      "chatBridge.server",
      "notifications.server",
      "leaderboard.server",
      "tpsAlerts.server",
      "downtimeAlerts.server",
      "reports.server",
    ]);
  });

  it("accepts a single chatBridge object", () => {
    const g = { chatBridge: { channelId: "1", server: "only" } } as unknown as GuildConfig;
    expect(bridgesOf(g)).toHaveLength(1);
    expect(referencedServerIds(g)).toEqual(new Set(["only"]));
  });

  it("feeds the runtime allowed set and the unknown-server check alike", () => {
    expect(referencedServerIds(full)).toEqual(
      new Set(["d", "b1", "b2", "n1", "n2", "l", "t", "x", "r"]),
    );
    const text = warningsFor({ g1: full, g2: { defaultServer: "a" } });
    for (const ghost of ["d", "b1", "b2", "n1", "n2", "l", "t", "x", "r"]) {
      expect(text).toContain(`references unknown server "${ghost}"`);
    }
    expect(text).not.toContain("can target EVERY configured server");
  });

  it("agrees that a guild naming nothing is unscoped", () => {
    const bare = {} as GuildConfig;
    expect(guildServerScopes(bare).every((s) => s.ids.length === 0)).toBe(true);
    expect(referencedServerIds(bare).size).toBe(0);
    expect(allowedServerIdsIn({ g1: bare, g2: { defaultServer: "a" } as GuildConfig }, "g1")).toBeNull();
    expect(warningsFor({ g1: bare, g2: { defaultServer: "a" } })).toContain(
      "guilds.g1: no allowedServers/defaultServer set",
    );
  });

  it("agrees that an explicit empty allowedServers denies", () => {
    const denied = { allowedServers: [] } as unknown as GuildConfig;
    expect(allowedServerIdsIn({ g1: denied, g2: { defaultServer: "a" } as GuildConfig }, "g1")!.size).toBe(0);
    const text = warningsFor({ g1: denied, g2: { defaultServer: "a" } });
    expect(text).toContain("guilds.g1: allowedServers is empty");
    expect(text).not.toContain("guilds.g1: no allowedServers/defaultServer set");
  });
});
