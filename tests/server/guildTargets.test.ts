import { describe, it, expect } from "vitest";
import { allowedServerIdsIn } from "../../src/core/utils/server/guildTargets.js";
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
